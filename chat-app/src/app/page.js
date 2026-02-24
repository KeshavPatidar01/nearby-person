"use client";

import { useEffect, useState } from "react";
import { UserButton, SignInButton, SignedIn, SignedOut, useUser } from "@clerk/nextjs";
import { syncUser, updateLocation, getNearbyUsers, getChatUsers } from "@/app/actions/user";
import { startConversation } from "@/app/actions/chat";
import { useRouter } from "next/navigation";
import { io } from "socket.io-client"; 

let socket;

export default function Home() {
  const [loading, setLoading] = useState(true);
  const [displayUsers, setDisplayUsers] = useState([]); 
  const [notifications, setNotifications] = useState(new Set()); 
  const router = useRouter();
  const { user } = useUser();

  useEffect(() => {
    const initApp = async () => {
      setLoading(true);
      const syncedUser = await syncUser();
      
      if (!syncedUser) {
        setLoading(false);
        return;
      }

      socket = io();
      socket.emit("join_user_room", syncedUser.clerkId);

      socket.on("new_message_notification", (data) => {
        setNotifications((prev) => {
            const newSet = new Set(prev);
            newSet.add(data.senderId);
            return newSet;
        });

        setDisplayUsers((prevUsers) => {
            const updatedUsers = prevUsers.map(u => {
                if (u.clerkId === data.senderId) {
                    return { ...u, lastMessageAt: Date.now(), hasNotification: true };
                }
                return u;
            });
            return updatedUsers.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
        });
      });

      await refreshData();
    };

    initApp();

    return () => { if (socket) socket.disconnect(); };
  }, [user]);

  const refreshData = async () => {
      const historyList = await getChatUsers();
      let nearbyList = [];
      
      if ("geolocation" in navigator) {
        try {
            const position = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej));
            const { latitude, longitude } = position.coords;
            await updateLocation(latitude, longitude);
            nearbyList = await getNearbyUsers();
        } catch(e) { console.error("Location Error:", e); }
      }

      const usersMap = new Map();

      historyList.forEach(u => {
        usersMap.set(u.clerkId, { 
          ...u, isOnline: false, statusText: "Offline", 
          lastMessageAt: new Date(u.lastMessageAt).getTime(), hasNotification: false 
        });
      });

      nearbyList.forEach(u => {
        const existing = usersMap.get(u.clerkId);
        usersMap.set(u.clerkId, { 
          ...existing, ...u, 
          isOnline: true, statusText: `${u.distance} KM`,
          lastMessageAt: existing ? existing.lastMessageAt : 0, hasNotification: false
        });
      });

      let finalUsers = Array.from(usersMap.values());
      finalUsers.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
      
      setDisplayUsers(finalUsers);
      setLoading(false);
  };

  const handleUserClick = async (otherUserId) => {
    setNotifications((prev) => {
        const newSet = new Set(prev);
        newSet.delete(otherUserId);
        return newSet;
    });
    
    setDisplayUsers(prev => prev.map(u => 
        u.clerkId === otherUserId ? { ...u, hasNotification: false } : u
    ));

    const conversationId = await startConversation(otherUserId);
    if (conversationId) router.push(`/chat/${conversationId}`);
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans pb-24 relative overflow-y-auto selection:bg-purple-500">
      
      {/* 🌌 Modern Background (Animated Gradient) */}
      <div className="fixed inset-0 z-0 pointer-events-none">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,#1a103c,transparent_50%)] opacity-60"></div>
          <div className="absolute bottom-0 left-0 right-0 h-[500px] bg-[linear-gradient(to_top,#050505,transparent)]"></div>
          <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'linear-gradient(#444 1px, transparent 1px), linear-gradient(90deg, #444 1px, transparent 1px)', backgroundSize: '40px 40px' }}></div>
      </div>

      {/* 🛡️ Header (Trust & Safety) */}
      <header className="sticky top-0 z-50 bg-[#050505]/80 backdrop-blur-xl border-b border-white/5 px-6 py-4 flex items-center justify-between shadow-2xl">
        <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-wide bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
                Nexus<span className="text-purple-500">Grid</span>
            </h1>
            <span className="hidden md:flex items-center gap-1 bg-green-900/30 border border-green-500/30 px-2 py-0.5 rounded-full text-[10px] text-green-400 font-medium">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
                Secure
            </span>
        </div>
        
        <SignedIn><UserButton afterSignOutUrl="/" /></SignedIn>
        <SignedOut>
            <SignInButton mode="modal">
                <button className="text-xs bg-white text-black px-5 py-2.5 rounded-full font-bold hover:scale-105 transition-transform shadow-[0_0_15px_rgba(255,255,255,0.3)]">
                    Login Securely
                </button>
            </SignInButton>
        </SignedOut>
      </header>

      {/* 🚀 Main Content */}
      <main className="relative z-10 px-4 pt-8 max-w-5xl mx-auto space-y-8">
        
        <SignedIn>
          <div className="space-y-4 animate-[fadeIn_0.5s_ease-out]">
             
             {/* Title & Stats */}
             <div className="flex justify-between items-end px-2 border-b border-white/5 pb-2">
               <div>
                   <h3 className="text-lg font-semibold text-gray-200">Nearby Connections</h3>
                   <p className="text-xs text-gray-500">End-to-end encrypted • Private location</p>
               </div>
               <span className="text-xs bg-purple-500/10 text-purple-400 px-3 py-1 rounded-full border border-purple-500/20">
                   {displayUsers.length} Active
               </span>
             </div>

            {loading ? (
                <div className="flex flex-col items-center justify-center py-32 gap-4">
                    <div className="w-10 h-10 border-4 border-purple-600 border-t-transparent rounded-full animate-spin"></div>
                    <p className="text-gray-500 text-sm animate-pulse">Establishing secure connection...</p>
                </div>
            ) : (
                // 📱 Responsive Grid (Mobile: 1 col, Tablet: 2 col)
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-4">
                    {displayUsers.map((user, index) => {
                        const hasNotif = notifications.has(user.clerkId) || user.hasNotification;
                        
                        return (
                          <div 
                            key={user.id} 
                            onClick={() => handleUserClick(user.clerkId)}
                            style={{ animationDelay: `${index * 0.05}s` }}
                            className={`group relative flex items-center gap-4 p-4 border rounded-2xl transition-all cursor-pointer overflow-hidden animate-[slideUp_0.4s_ease-out_both]
                              ${hasNotif
                                ? "bg-purple-900/10 border-purple-500 shadow-[0_0_20px_rgba(168,85,247,0.15)] scale-[1.01]" 
                                : "bg-[#0a0a0a]/60 border-white/5 hover:border-purple-500/30 hover:bg-[#0f0f0f] hover:shadow-xl hover:-translate-y-1"
                              }`}
                          >
                            {/* Hover Glow Effect */}
                            <div className="absolute inset-0 bg-gradient-to-r from-purple-500/0 via-purple-500/5 to-purple-500/0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"></div>

                            {/* Avatar */}
                            <div className="relative shrink-0">
                              <div className={`w-16 h-16 rounded-2xl overflow-hidden flex items-center justify-center border-2 shadow-lg transition-transform group-hover:scale-105 ${
                                hasNotif ? "border-purple-500" : "border-[#222]"
                              }`}>
                                {user.imageUrl ? (
                                    <img src={user.imageUrl} alt={user.name} className="w-full h-full object-cover" />
                                ) : (
                                    <span className="text-2xl font-bold text-gray-400">{user.name?.[0]}</span>
                                )}
                              </div>
                              {user.isOnline && (
                                  <span className="absolute -bottom-1 -right-1 flex h-4 w-4">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-4 w-4 bg-green-500 border-2 border-[#0a0a0a]"></span>
                                  </span>
                              )}
                            </div>

                            {/* Info */}
                            <div className="flex-1 min-w-0 z-10">
                              <div className="flex justify-between items-start">
                                <div>
                                    <h3 className={`font-bold text-lg leading-tight truncate ${hasNotif ? "text-white" : "text-gray-200 group-hover:text-purple-200 transition-colors"}`}>
                                        {user.name}
                                    </h3>
                                    <p className={`text-xs mt-1 truncate ${hasNotif ? "text-purple-300 font-medium" : "text-gray-500 group-hover:text-gray-400"}`}>
                                        {hasNotif ? "📩 Sent you a message" : (user.isOnline ? "👋 Tap to chat now" : "Last seen recently")}
                                    </p>
                                </div>

                                {hasNotif ? (
                                  <span className="bg-red-500 text-white text-[10px] font-bold px-2 py-1 rounded-full shadow-[0_0_10px_rgba(239,68,68,0.5)] animate-bounce">
                                     NEW
                                  </span>
                                ) : (
                                   <div className="flex flex-col items-end gap-1">
                                      {/* City Badge */}
                                      <span className="text-[10px] font-semibold text-gray-400 bg-white/5 px-2 py-0.5 rounded-md border border-white/5 flex items-center gap-1">
                                         📍 {user.city || "Hidden"}
                                      </span>
                                      
                                      <div className="flex items-center gap-2">
                                          <span className={`text-[10px] font-medium ${user.isOnline ? "text-green-400" : "text-gray-600"}`}>
                                            {user.statusText}
                                          </span>
                                          {user.latitude && (
                                            <a 
                                              href={`https://www.google.com/maps?q=${user.latitude},${user.longitude}`}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              onClick={(e) => e.stopPropagation()}
                                              className="text-gray-600 hover:text-blue-400 transition-colors"
                                              title="View Safe Location"
                                            >
                                              🗺️
                                            </a>
                                          )}
                                      </div>
                                   </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                    })}
                </div>
            )}
          </div>
        </SignedIn>

        {/* 🔒 Footer Trust Badge */}
        <div className="text-center pt-10 pb-6 opacity-40 hover:opacity-100 transition-opacity">
            <div className="flex justify-center items-center gap-2 text-xs text-gray-400 mb-2">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                <span>End-to-End Encrypted & Secure</span>
            </div>
            <p className="text-[10px] text-gray-600">Your location is only visible to nearby users.</p>
        </div>

        <SignedOut>
            <div className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-6">
                <div className="w-20 h-20 bg-purple-500/10 rounded-full flex items-center justify-center mb-4 animate-pulse">
                    <svg width="40" height="40" className="text-purple-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                </div>
                <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-gray-500">
                    Connect with people nearby.
                </h2>
                <p className="text-gray-400 max-w-md">
                    Secure, fast, and real-time chat based on your location. <br/> Join the NexusGrid today.
                </p>
            </div>
        </SignedOut>
      </main>
    </div>
  );
}