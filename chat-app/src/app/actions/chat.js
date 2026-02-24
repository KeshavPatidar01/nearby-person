"use server";
import { currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

// ==========================================
// 1. SEND MESSAGE
// ==========================================
export async function sendMessage(conversationId, content) {
  const user = await currentUser();
  if (!user) return null;

  try {
    // Check user in DB
    const dbUser = await prisma.user.findUnique({
      where: { clerkId: user.id }
    });

    if (!dbUser) return null;

    // Create Message
    const message = await prisma.message.create({
      data: {
        content: content,
        conversationId: conversationId,
        senderId: user.id,
        isRead: false, // Default unread (Grey Tick)
      }
    });
    
    return message;
  } catch (error) {
    console.error("Message send failed:", error);
    return null;
  }
}

// ==========================================
// 2. GET MESSAGES (Load History)
// ==========================================
export async function getMessages(conversationId) {
  try {
    const messages = await prisma.message.findMany({
      where: { conversationId: conversationId },
      orderBy: { createdAt: 'asc' }, // Oldest first
      include: { sender: true }
    });
    return messages;
  } catch (error) {
    console.error("Error fetching messages:", error);
    return [];
  }
}

// ==========================================
// 3. START CONVERSATION (Find or Create)
// ==========================================
export async function startConversation(otherUserId) {
  const user = await currentUser();
  if (!user) return null;

  try {
    // Check if chat already exists
    const existing = await prisma.conversation.findFirst({
      where: {
        AND: [
          { users: { some: { clerkId: user.id } } },
          { users: { some: { clerkId: otherUserId } } }
        ]
      }
    });

    if (existing) return existing.id;

    // Create new chat
    const newChat = await prisma.conversation.create({
      data: {
        users: {
          connect: [
            { clerkId: user.id },
            { clerkId: otherUserId }
          ]
        }
      }
    });
    return newChat.id;
  } catch (e) {
    console.error("Error starting conversation:", e);
    return null;
  }
}

// ==========================================
// 4. DELETE CONVERSATION (Permanent Delete)
// ==========================================
export async function deleteConversation(conversationId) {
  const user = await currentUser();
  if (!user) return { success: false };

  try {
    // Step A: Pehle saare messages delete karo (Cascade safety)
    await prisma.message.deleteMany({
      where: { conversationId: conversationId }
    });

    // Step B: Ab conversation delete karo (Permanent)
    await prisma.conversation.delete({
      where: { id: conversationId }
    });

    return { success: true };
  } catch (error) {
    console.error("Delete conversation failed:", error);
    return { success: false };
  }
}

// ==========================================
// 5. MARK AS READ (Blue Tick Logic)
// ==========================================
export async function markAsRead(conversationId) {
  const user = await currentUser();
  if (!user) return { success: false };

  try {
    // Logic: Us chat ke wo messages jo 'Unread' hain aur 'Maine NAHI bheje'
    // unhe 'Read' mark kar do.
    await prisma.message.updateMany({
      where: {
        conversationId: conversationId,
        senderId: { not: user.id }, // Sender main nahi hona chahiye
        isRead: false
      },
      data: {
        isRead: true
      }
    });
    
    return { success: true };
  } catch (error) {
    console.error("Mark as read failed", error);
    return { success: false };
  }
  
}







// ==========================================
// 6. ADD REACTION (New)
// ==========================================
export async function addReaction(messageId, emoji) {
  try {
    await prisma.message.update({
      where: { id: messageId },
      data: { reaction: emoji } // DB me save karo
    });
    return { success: true };
  } catch (error) {
    console.error("Reaction failed:", error);
    return { success: false };
  }
}






