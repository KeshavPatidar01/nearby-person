"use server";

import { currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

// ==========================================
// 1. SYNC USER (Login/Register) - ✅ FIXED
// ==========================================
export async function syncUser() {
  try {
    const user = await currentUser();
    if (!user) return null;

    // Check agar user pehle se hai
    const existingUser = await prisma.user.findUnique({
      where: { clerkId: user.id },
    });

    if (existingUser) {
      return existingUser;
    }

    // Naya user banao (Ab photo bhi save hogi)
    const newUser = await prisma.user.create({
      data: {
        clerkId: user.id,
        name: `${user.firstName} ${user.lastName}`,
        email: user.emailAddresses[0].emailAddress,
        imageUrl: user.imageUrl, // 👈 YE MISSING THA, AB ADD KAR DIYA
        latitude: null, // Default null
        longitude: null // Default null
      },
    });

    return newUser;

  } catch (error) {
    console.error("Error syncing user:", error);
    return null;
  }
}

// ==========================================
// 2. UPDATE LOCATION
// ==========================================
export async function updateLocation(lat, lng) {
  try {
    const user = await currentUser();
    if (!user) throw new Error("Unauthorized");

    await prisma.user.update({
      where: { clerkId: user.id },
      data: {
        latitude: lat,
        longitude: lng,
      },
    });
    
    return { success: true };
  } catch (error) {
    console.error("Location update failed:", error);
    return { success: false };
  }
}

// ==========================================
// 3. GET NEARBY USERS (Radius Logic) - ✅ FIXED
// ==========================================
export async function getNearbyUsers() {
  try {
    const currentUserData = await currentUser();
    if (!currentUserData) return [];

    // Pehle khud ka data nikalo
    const me = await prisma.user.findUnique({
      where: { clerkId: currentUserData.id },
    });

    // 🛑 AGAR MERI LOCATION NAHI HAI, TO KUCH NAHI DIKHEGA
    // (Ye logic sahi hai, par dhyan rakhna location on honi chahiye)
    if (!me?.latitude || !me?.longitude) {
      console.log("User location not set yet");
      return []; 
    }

    // Baaki users nikalo (Exclude myself)
    const users = await prisma.user.findMany({
      where: {
        NOT: {
          clerkId: currentUserData.id,
        },
        // Sirf unhe dikhao jinki location set hai
        latitude: { not: null },
        longitude: { not: null } 
      },
      select: {
        id: true,
        name: true,
        email: true,
        latitude: true,
        longitude: true,
        clerkId: true,
        imageUrl: true, 
      }
    });

    const usersWithDistance = users.map((user) => {
      const distance = calculateDistance(
        me.latitude,
        me.longitude,
        user.latitude,
        user.longitude
      );
      return { ...user, distance };
    });

    return usersWithDistance.sort((a, b) => a.distance - b.distance);

  } catch (error) {
    console.error("Error fetching nearby users:", error);
    return [];
  }
}

// ==========================================
// 4. GET CHAT USERS
// ==========================================
export async function getChatUsers() {
  const user = await currentUser();
  if (!user) return [];

  try {
    const conversations = await prisma.conversation.findMany({
      where: {
        users: { some: { clerkId: user.id } }
      },
      include: {
        users: true,
        messages: {
           take: 1,
           orderBy: { createdAt: 'desc' }
        }
      }
    });

    const chatUsers = conversations.map(conv => {
      const otherUser = conv.users.find(u => u.clerkId !== user.id);
      
      if (!otherUser) return null;

      return {
        id: otherUser.id,
        name: otherUser.name,
        email: otherUser.email,
        clerkId: otherUser.clerkId,
        imageUrl: otherUser.imageUrl, // 👈 Chat me bhi photo chahiye
        isHistory: true, 
        lastMessageAt: conv.messages[0]?.createdAt || conv.createdAt
      };
    }).filter(Boolean);

    return chatUsers.sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));

  } catch (error) {
    console.error("Error fetching chat users:", error);
    return [];
  }
}

// ==========================================
// HELPER: Haversine Formula
// ==========================================
function calculateDistance(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return 9999;

  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
    Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) *
    Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  
  return parseFloat(distance.toFixed(1));
}