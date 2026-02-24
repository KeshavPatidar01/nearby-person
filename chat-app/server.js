// 👇 1. DB connection ke liye zaroori hai
require("dotenv").config(); 

const { createServer } = require("http");
const { parse } = require("url");
const next = require("next");
const { Server } = require("socket.io");
const { PrismaClient } = require("@prisma/client");

const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();
const prisma = new PrismaClient();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });

  const io = new Server(httpServer);

  io.on("connection", (socket) => {
    // console.log("New User Connected:", socket.id);
    
    // ===========================
    // 1. ROOM JOINING
    // ===========================
    
    // Join Chat Room
    socket.on("join_room", (roomId) => {
      socket.join(roomId);
    });

    // Join User's Personal Notification Room
    socket.on("join_user_room", (userId) => {
      if (userId) socket.join(userId);
    });

    // ===========================
    // 2. MESSAGE FEATURES
    // ===========================

    // Mark Read (Blue Ticks)
    socket.on("mark_messages_read", ({ conversationId }) => {
      // Blue tick sabko dikhna chahiye (including me)
      io.to(conversationId).emit("messages_read_update");
    });

    // Send Message
    socket.on("send_message", async (data) => {
      const { content, conversationId, senderId } = data;

      try {
        // A. Save to DB
        const savedMessage = await prisma.message.create({
          data: {
            content,
            conversation: { connect: { id: conversationId } },
            sender: { connect: { clerkId: senderId } },
            isRead: false
          },
          include: { sender: true }
        });

        // B. Chat Room update (Real-time msg)
        io.to(conversationId).emit("receive_message", savedMessage);

        // C. Notification Logic (Popup for receiver)
        const conversation = await prisma.conversation.findUnique({
            where: { id: conversationId },
            include: { users: true }
        });

        if (conversation) {
            const receiver = conversation.users.find(u => u.clerkId !== senderId);
            if (receiver) {
                io.to(receiver.clerkId).emit("new_message_notification", {
                    senderId: senderId,
                    content: content,
                    senderName: savedMessage.sender.name
                });
            }
        }
        
      } catch (error) {
        // Handle Deleted Chat Error (P2025)
        if (error.code === 'P2025') {
            console.log("⚠️ Chat deleted. Redirecting sender...");
            socket.emit("force_redirect");
        } else {
            console.error("❌ Message Error:", error.message);
        }
      }
    });

    // ===========================
    // 3. TYPING INDICATOR (New)
    // ===========================
    
    socket.on("typing", (roomId) => {
      // Sender ko chhod kar room me baaki sabko batao
      socket.to(roomId).emit("display_typing");
    });

    socket.on("stop_typing", (roomId) => {
      socket.to(roomId).emit("hide_typing");
    });

    // ===========================
    // 4. DELETE CHAT LOGIC
    // ===========================
    
    socket.on("chat_deleted", ({ conversationId }) => {
        console.log(`🗑️ Chat Deleted: ${conversationId}`);
        // Sirf dusre user ko redirect karo (Sender khud handle kar lega)
        socket.to(conversationId).emit("force_redirect");
    });


    // server.js ke andar jahan baaki socket.on hain, wahan ye add karo:

    // 7. EMOJI REACTION LOGIC
    socket.on("send_reaction", ({ conversationId, messageId, emoji }) => {
      // Room mein sabko batao (sender ko bhi, taaki confirm ho jaye)
      io.to(conversationId).emit("receive_reaction", { messageId, emoji });
    });
    // 8. SCREENSHOT DETECTION
    socket.on("screenshot_taken", (conversationId) => {
      // Doosre user ko batao (Alert bhejo)
      socket.to(conversationId).emit("screenshot_alert", {
         text: "📸 took a screenshot!",
         time: new Date()
      });
    });

  });

  const PORT = process.env.PORT || 3000;
  httpServer.listen(PORT, (err) => {
    if (err) throw err; 
    console.log(`> Ready on http://localhost:${PORT}`);
  });

  
});