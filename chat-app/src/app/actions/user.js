"use server";

import { currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

// ==========================================
// 1. SYNC USER (Login/Register)
// ==========================================
export async function syncUser() {
  try {
    const user = await currentUser();
    if (!user) return null;

    const existingUser = await prisma.user.findUnique({
      where: { clerkId: user.id },
    });

    if (existingUser) return existingUser;

    const newUser = await prisma.user.create({
      data: {
        clerkId: user.id,
        name: `${user.firstName} ${user.lastName}`,
        email: user.emailAddresses[0].emailAddress,
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
// 3. GET NEARBY USERS (Radius Logic)
// ==========================================
export async function getNearbyUsers() {
  try {
    const currentUserData = await currentUser();
    if (!currentUserData) return [];

    const me = await prisma.user.findUnique({
      where: { clerkId: currentUserData.id },
    });

    if (!me?.latitude || !me?.longitude) {
      return [];
    }

    const users = await prisma.user.findMany({
      where: {
        NOT: {
          clerkId: currentUserData.id,
        },
      },
      select: {
        id: true,
        name: true,
        email: true,
        latitude: true,
        longitude: true,
        clerkId: true,
        imageUrl: true, // 👈 YE LINE SABSE ZAROORI HAI (Isse Check Karo)
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
// 4. GET CHAT USERS (👇 Ye Missing tha, ab add kar diya hai)
// ==========================================
export async function getChatUsers() {
  const user = await currentUser();
  if (!user) return [];

  try {
    // Wo conversations dhoondo jisme current user hai
    const conversations = await prisma.conversation.findMany({
      where: {
        users: { some: { clerkId: user.id } }
      },
      include: {
        users: true, // Users ka data
        messages: {  // Last message sorting ke liye
            take: 1,
            orderBy: { createdAt: 'desc' }
        }
      }
    });

    // Dusre user ko extract karo
    const chatUsers = conversations.map(conv => {
      // Find the user who is NOT me
      const otherUser = conv.users.find(u => u.clerkId !== user.id);
      
      if (!otherUser) return null;

      return {
        id: otherUser.id,
        name: otherUser.name,
        email: otherUser.email,
        clerkId: otherUser.clerkId,
        isHistory: true, 
        // Agar message hai to uska time, nahi to conversation creation time
        lastMessageAt: conv.messages[0]?.createdAt || conv.createdAt
      };
    }).filter(Boolean); // Remove nulls if any

    // Sort by latest message
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