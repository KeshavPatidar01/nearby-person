"use client";

import { useEffect, useState, useRef } from "react";
import { useUser } from "@clerk/nextjs";
import { useParams, useRouter } from "next/navigation";
import { io } from "socket.io-client";
import { getMessages, markAsRead, deleteConversation, addReaction } from "@/app/actions/chat"; 

let socket;
const REACTIONS = ["❤️", "😂", "🔥", "😮", "😢", "👍"];

export default function ChatPage() {
  const params = useParams();
  const conversationId = params.id;
  const { user } = useUser();
  const router = useRouter(); 

  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [isOtherUserTyping, setIsOtherUserTyping] = useState(false);
  
  // Voice & UI States
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [activeReactionId, setActiveReactionId] = useState(null);
  
  // 👇 NEW: Screenshot Alert State
  const [screenshotAlert, setScreenshotAlert] = useState(null);

  const typingTimeoutRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerIntervalRef = useRef(null);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    socket = io();

    if (conversationId && user) {
      socket.on("connect", () => {
         socket.emit("join_room", conversationId);
      });
      if (socket.connected) socket.emit("join_room", conversationId);

      getMessages(conversationId).then((history) => {
        setMessages(history);
        markAsRead(conversationId).then(() => socket.emit("mark_messages_read", { conversationId }));
      });

      // --- LISTENERS ---
      // --- LISTENERS ---

      // 👇👇👇 IS CODE KO COPY KARKE REPLACE KARO 👇👇👇
      socket.on("receive_message", (newMsg) => {
        
        setMessages((prev) => {
          // 1. Dhoondo ki kya ye message mere paas pehle se hai (Fake ID ke saath)?
          // Hum check karenge: Same Sender + Same Content + ID ki lambai (Fake ID choti hoti hai)
          const existingMsgIndex = prev.findIndex(
              (msg) => 
                  msg.senderId === newMsg.senderId && 
                  msg.content === newMsg.content && 
                  msg.id.length < 20 // Date.now() 13 digits ka hota hai, UUID 36 ka
          );

          if (existingMsgIndex !== -1) {
              // 🔄 SWAP MAGIC: Fake ID hatao, Real ID lagao!
              console.log("Replacing Fake ID", prev[existingMsgIndex].id, "with Real ID", newMsg.id);
              const updatedMessages = [...prev];
              updatedMessages[existingMsgIndex] = newMsg; 
              return updatedMessages;
          }

          // 2. Agar ye doosre ka message hai, to duplicate check karke add karo
          if (prev.some(msg => msg.id === newMsg.id)) return prev;
          
          return [...prev, newMsg];
        });

        // Notification sirf tab bajao jab message DOOSRE ne bheja ho
        if (newMsg.senderId !== user.id) {
            setIsOtherUserTyping(false);
            markAsRead(conversationId);
            socket.emit("mark_messages_read", { conversationId });
        }
      });
      // 👆👆👆 YAHAN TAK REPLACE KARO 👆👆👆

      socket.on("messages_read_update", () => {
         setMessages((prev) => prev.map((msg) => ({ ...msg, isRead: true })));
      });

      socket.on("force_redirect", () => window.location.href = "/");
      socket.on("display_typing", () => setIsOtherUserTyping(true));
      socket.on("hide_typing", () => setIsOtherUserTyping(false));

      socket.on("receive_reaction", ({ messageId, emoji }) => {
          setMessages((prev) => prev.map((msg) => msg.id === messageId ? { ...msg, reaction: emoji } : msg));
      });

      // 👇 SCREENSHOT LISTENER (Receiver Side)
      socket.on("screenshot_alert", (data) => {
          // Show Alert temporarily
          setScreenshotAlert(data);
          // 3 second baad hata do
          setTimeout(() => setScreenshotAlert(null), 4000);
      });
    }

    return () => { if (socket) socket.disconnect(); };
  }, [conversationId, user]);

  // 👇 SCREENSHOT KEY DETECTION LOGIC (Sender Side)
  useEffect(() => {
      const handleKeyDown = (e) => {
          // Windows: PrintScreen key
          // Mac: Meta (Cmd) + Shift + 3/4/S (Browser kabhi kabhi block karta hai, but worth trying)
          if (e.key === "PrintScreen" || (e.metaKey && e.shiftKey)) {
              console.log("📸 Screenshot Detected!");
              socket.emit("screenshot_taken", conversationId);
          }
      };

      // Event Listener Add karo
      window.addEventListener("keyup", handleKeyDown); // KeyUp better hai PrintScreen ke liye
      
      return () => {
          window.removeEventListener("keyup", handleKeyDown);
      };
  }, [conversationId]);


  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isOtherUserTyping, isRecording, screenshotAlert]); // Alert aane par bhi scroll ho

  // --- ACTIONS (Same as before) ---
  const handleInputChange = (e) => {
    setNewMessage(e.target.value);
    if (!socket) return;
    socket.emit("typing", conversationId);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => socket.emit("stop_typing", conversationId), 2000);
  };

  const handleSend = async () => {
    if (!newMessage.trim()) return;
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    socket.emit("stop_typing", conversationId);

    const tempId = Date.now().toString(); 
    const messageData = {
      id: tempId, content: newMessage, conversationId, senderId: user.id, senderName: user.fullName, isRead: false, createdAt: new Date(), reaction: null
    };
    setMessages((prev) => [...prev, messageData]);
    setNewMessage("");
    socket.emit("send_message", messageData);
  };

  // 👇 UPDATED FUNCTION (Isse replace karo)
  const sendReaction = async (messageId, emoji) => {
      // 1. UI Update (Optimistic)
      setMessages((prev) => prev.map((msg) => msg.id === messageId ? { ...msg, reaction: emoji } : msg));
      
      // 2. Socket Update (Dusron ko dikhane ke liye)
      socket.emit("send_reaction", { conversationId, messageId, emoji });
      setActiveReactionId(null);

      // 3. 👇 DATABASE SAVE (Ye line missing thi!)
      await addReaction(messageId, emoji);
  };

  // --- VOICE ---
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => sendAudioMessage(reader.result);
        stream.getTracks().forEach(track => track.stop());
      };
      mediaRecorder.start();
      setIsRecording(true);
      setRecordingDuration(0);
      timerIntervalRef.current = setInterval(() => setRecordingDuration(p => p + 1), 1000);
    } catch (error) { alert("Mic denied"); }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      clearInterval(timerIntervalRef.current);
    }
  };

  const cancelRecording = () => {
      if (mediaRecorderRef.current) {
          mediaRecorderRef.current.stop();
          mediaRecorderRef.current.onstop = null;
          setIsRecording(false);
          clearInterval(timerIntervalRef.current);
      }
  };

  const sendAudioMessage = (base64Audio) => {
    const tempId = Date.now().toString(); 
    const messageData = {
      id: tempId, content: base64Audio, conversationId, senderId: user.id, senderName: user.fullName, isRead: false, createdAt: new Date(), reaction: null
    };
    setMessages((prev) => [...prev, messageData]);
    socket.emit("send_message", messageData);
  };

  const handleDelete = async () => {
    if (!confirm("Delete chat for everyone?")) return;
    setIsDeleting(true);
    const res = await deleteConversation(conversationId);
    if (res?.success) {
        socket.emit("chat_deleted", { conversationId });
        window.location.href = "/";
    } else setIsDeleting(false);
  };

  const formatTime = (seconds) => `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`;

  const renderContent = (content) => {
      if (content.startsWith("data:audio")) {
          return <audio controls src={content} className="w-[200px] h-8 mt-1 rounded-lg" />;
      }
      return <p className="mb-0.5 text-[15px] leading-relaxed break-words">{content}</p>;
  };

  return (
    <div className="flex flex-col h-screen bg-[#050505] text-white font-sans overflow-hidden" onClick={() => setActiveReactionId(null)}>
      
      {/* HEADER (Glassmorphism) */}
      <div className="absolute top-0 w-full z-20 backdrop-blur-xl bg-[#050505]/70 border-b border-white/5 p-4 flex justify-between items-center shadow-lg">
         <div className="flex items-center gap-4">
            <button onClick={() => router.back()} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            </button>
            <div>
              <h2 className="font-bold text-lg tracking-wide">Chat</h2>
              <div className="flex items-center gap-1.5">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                  </span>
                  <span className="text-xs text-green-400 font-medium">Online</span>
              </div>
            </div>
         </div>
         <button onClick={handleDelete} disabled={isDeleting} className="p-2.5 text-gray-400 hover:text-red-500 hover:bg-red-500/10 rounded-full transition-all active:scale-95">
            {isDeleting ? <div className="w-5 h-5 border-2 border-red-500 border-t-transparent rounded-full animate-spin"></div> : 
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>}
         </button>
      </div>

      {/* MESSAGES AREA */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 pt-24 space-y-6 scrollbar-hide bg-[url('/chat-bg-pattern.png')] bg-repeat bg-[length:400px]">
        {messages.map((msg) => {
          const isMe = msg.senderId === user?.id;
          return (
            <div key={msg.id} className={`flex w-full ${isMe ? "justify-end" : "justify-start"} group mb-2`}>
              <div className="relative max-w-[80%]">
                  {/* EMOJI PICKER POPUP */}
                  {activeReactionId === msg.id && (
                      <div className={`absolute -top-14 ${isMe ? 'right-0' : 'left-0'} bg-[#1a1a1a]/90 backdrop-blur-md border border-white/10 rounded-full px-3 py-1.5 flex gap-2 shadow-2xl z-50 animate-[popIn_0.2s_ease-out]`}>
                          {REACTIONS.map((emoji, i) => (
                              <button key={emoji} onClick={() => sendReaction(msg.id, emoji)} 
                                className="text-2xl hover:scale-150 transition-transform active:scale-90 animate-[fadeIn_0.3s]" 
                                style={{animationDelay: `${i * 0.05}s`}}>
                                {emoji}
                              </button>
                          ))}
                      </div>
                  )}

                  {/* MESSAGE BUBBLE */}
                  <div 
                    onDoubleClick={(e) => { e.stopPropagation(); setActiveReactionId(msg.id === activeReactionId ? null : msg.id); }}
                    className={`relative px-5 py-3 rounded-[20px] shadow-sm cursor-pointer transition-all active:scale-[0.98] 
                        ${isMe 
                            ? "bg-gradient-to-br from-indigo-600 to-purple-700 text-white rounded-br-none" 
                            : "bg-[#1f1f1f] text-gray-100 rounded-bl-none border border-white/5"
                        } animate-[messagePop_0.4s_cubic-bezier(0.175,0.885,0.32,1.275)]`}
                  >
                    {renderContent(msg.content)}
                    
                    <div className="flex justify-end items-center gap-1 mt-1 opacity-70">
                      <span className="text-[10px] font-medium tracking-wide">{new Date(msg.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                      {isMe && (
                         msg.isRead 
                         ? <span className="text-cyan-300 flex"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5"/></svg><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="-ml-1.5"><path d="M20 6L9 17l-5-5"/></svg></span>
                         : <span className="text-gray-400 flex"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5"/></svg></span>
                      )}
                    </div>

                    {/* REACTION BADGE */}
                    {msg.reaction && (
                        <div className={`absolute -bottom-2 ${isMe ? '-left-2' : '-right-2'} bg-[#2a2a2a] border border-white/10 rounded-full w-7 h-7 flex items-center justify-center text-sm shadow-lg animate-[bounceIn_0.4s_cubic-bezier(0.68,-0.55,0.27,1.55)] z-10`}>
                            {msg.reaction}
                        </div>
                    )}
                  </div>
              </div>
            </div>
          );
        })}
        
        {/* TYPING WAVE */}
        {isOtherUserTyping && (
           <div className="flex justify-start pl-2 animate-[fadeIn_0.3s]">
             <div className="bg-[#1f1f1f] border border-white/5 px-4 py-3 rounded-2xl rounded-bl-none flex items-center gap-1.5 w-fit shadow-md">
               <span className="w-2 h-2 bg-purple-500 rounded-full animate-[bounce_1s_infinite]"></span>
               <span className="w-2 h-2 bg-purple-500 rounded-full animate-[bounce_1s_infinite_0.2s]"></span>
               <span className="w-2 h-2 bg-purple-500 rounded-full animate-[bounce_1s_infinite_0.4s]"></span>
             </div>
           </div>
        )}

        {/* 👇 SCREENSHOT ALERT (Ye hai naya hissa) */}
        {screenshotAlert && (
            <div className="flex justify-center animate-[slideUp_0.3s_ease-out]">
                <div className="bg-red-500/10 border border-red-500/50 text-red-200 px-4 py-2 rounded-full text-xs font-bold flex items-center gap-2 shadow-[0_0_20px_rgba(239,68,68,0.3)]">
                    <span className="animate-pulse">📸</span> {screenshotAlert.text}
                </div>
            </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* FOOTER INPUT */}
      <div className="p-3 bg-[#050505] border-t border-white/10" onClick={(e) => e.stopPropagation()}>
        {isRecording ? (
            <div className="flex items-center gap-4 bg-gradient-to-r from-red-900/20 to-red-900/10 p-2.5 rounded-[30px] border border-red-500/30 shadow-[0_0_20px_rgba(239,68,68,0.15)] animate-[slideUp_0.3s_ease-out]">
                <button onClick={cancelRecording} className="p-3 bg-red-500/10 text-red-400 rounded-full hover:bg-red-500 hover:text-white transition-all">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
                <div className="flex-1 flex items-center justify-center gap-2">
                    <div className="flex items-center gap-1 h-5">
                       {[...Array(5)].map((_, i) => (
                          <div key={i} className="w-1 bg-red-500 rounded-full animate-[soundWave_1s_ease-in-out_infinite]" style={{animationDelay: `${i * 0.1}s`, height: `${Math.random() * 100}%`}}></div>
                       ))}
                    </div>
                    <span className="text-red-400 font-mono font-bold w-12 text-center">{formatTime(recordingDuration)}</span>
                </div>
                <button onClick={stopRecording} className="p-3 bg-red-500 text-white rounded-full hover:scale-110 shadow-lg hover:shadow-red-500/40 transition-all">
                   <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
                </button>
            </div>
        ) : (
            <div className="flex items-end gap-2 bg-[#1a1a1a] p-1.5 rounded-[25px] border border-white/5 focus-within:border-purple-500/50 focus-within:ring-1 focus-within:ring-purple-500/30 transition-all duration-300 shadow-lg">
                <input 
                    className="flex-1 bg-transparent text-white placeholder:text-gray-500 px-5 py-3 focus:outline-none max-h-32 text-[15px]" 
                    value={newMessage} 
                    onChange={handleInputChange} 
                    onKeyDown={(e) => e.key === "Enter" && handleSend()} 
                    placeholder="Type a message..." 
                    autoComplete="off"
                />
                {newMessage.trim() ? (
                    <button onClick={handleSend} className="bg-purple-600 text-white p-3 rounded-full hover:bg-purple-500 active:scale-90 transition-all shadow-lg hover:shadow-purple-500/30">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
                    </button>
                ) : (
                    <button onClick={startRecording} className="bg-[#2a2a2a] text-gray-300 p-3 rounded-full hover:bg-[#333] hover:text-white active:scale-90 transition-all">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
                    </button>
                )}
            </div>
        )}
      </div>
    </div>
  );
}