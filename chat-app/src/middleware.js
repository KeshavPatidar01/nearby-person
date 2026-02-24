import { clerkMiddleware } from "@clerk/nextjs/server";

export default clerkMiddleware();

export const config = {
  matcher: [
    // 1. Static files aur Next.js internals ko ignore karo
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // 2. API routes par run karo
    '/(api|trpc)(.*)',
    // 3. ⚠️ IMPORTANT: Socket.io ko ignore mat hone do (Matlab is regex me socket.io match nahi hona chahiye)
    // Clerk usually socket requests ko rokta nahi hai agar wo public routes na maane jayein.
    // Sabse best hai ki hum upar wala regex hi use karein, wo socket.io ko pakad sakta hai.
    // Simple fix: Niche wala matcher use karo.
  ],
};