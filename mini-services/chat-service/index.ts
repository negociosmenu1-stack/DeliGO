import { createServer } from "http"
import express from "express"
import { Server, type Socket } from "socket.io"

// ============================================
// Chat WebSocket Service - DeliGO
// Port: 3003
//
// Architecture:
// - Socket.IO handles real-time event relay (default path: /socket.io/)
// - Express handles internal HTTP endpoints (/internal/*)
// - Messages are saved via REST API, then broadcast via Socket.IO
// - The client includes XTransformPort=3003 in all requests for Caddy routing
// ============================================

const app = express()
app.use(express.json())

const httpServer = createServer(app)

// Using default Socket.IO path (/socket.io/) so Express routes work on /internal/*
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
})

// ============================================
// Types
// ============================================
interface SocketAuth {
  userId: string
  userType: "cliente" | "negocio" | "repartidor" | "superadmin"
  userName: string
}

interface ChatMessage {
  id: string
  pedidoId: string
  remitente: string
  texto: string
  imagenUrl: string | null
  archivoUrl: string | null
  archivoNombre: string | null
  archivoTipo: string | null
  leido: boolean
  fecha: string
  clienteId: string | null
}

// Track connected users: socketId -> auth info
const connectedUsers = new Map<string, SocketAuth>()

// ============================================
// Socket Authentication Middleware
// ============================================
io.use((socket: Socket, next) => {
  const userId = socket.handshake.auth.userId as string | undefined
  const userType = socket.handshake.auth.userType as string | undefined
  const userName = socket.handshake.auth.userName as string | undefined

  if (!userId || !userType) {
    return next(new Error("Authentication required"))
  }

  socket.data.userId = userId
  socket.data.userType = userType
  socket.data.userName = userName || "Usuario"

  next()
})

// ============================================
// Socket Connection Handler
// ============================================
io.on("connection", (socket: Socket) => {
  const auth: SocketAuth = {
    userId: socket.data.userId,
    userType: socket.data.userType,
    userName: socket.data.userName,
  }

  console.log(`[Chat] Connected: ${auth.userType}:${auth.userId} (${socket.id})`)

  // Track connected user
  connectedUsers.set(socket.id, auth)

  // Notify user is online
  socket.emit("connected", { userId: auth.userId, userType: auth.userType })

  // Join a chat room for a specific order
  socket.on("join-room", (pedidoId: string) => {
    if (!pedidoId || typeof pedidoId !== "string") return
    const roomName = `pedido:${pedidoId}`
    socket.join(roomName)
    socket.to(roomName).emit("user-viewing", {
      pedidoId,
      userId: auth.userId,
      userType: auth.userType,
    })
  })

  // Leave a room
  socket.on("leave-room", (pedidoId: string) => {
    if (!pedidoId || typeof pedidoId !== "string") return
    socket.leave(`pedido:${pedidoId}`)
  })

  // Message sent event (client emits after API success)
  socket.on("message-sent", (data: { pedidoId: string; message: ChatMessage }) => {
    if (!data.pedidoId || !data.message) return
    const roomName = `pedido:${data.pedidoId}`
    socket.to(roomName).emit("new-message", data.message)
  })

  // Typing indicator
  socket.on("typing", (pedidoId: string) => {
    if (!pedidoId) return
    socket.to(`pedido:${pedidoId}`).emit("user-typing", {
      pedidoId,
      userId: auth.userId,
      userType: auth.userType,
      userName: auth.userName,
    })
  })

  // Stop typing indicator
  socket.on("stop-typing", (pedidoId: string) => {
    if (!pedidoId) return
    socket.to(`pedido:${pedidoId}`).emit("user-stop-typing", {
      pedidoId,
      userId: auth.userId,
    })
  })

  // Mark messages as read
  socket.on("mark-read", (pedidoId: string) => {
    if (!pedidoId) return
    socket.to(`pedido:${pedidoId}`).emit("messages-read", {
      pedidoId,
      userId: auth.userId,
      userType: auth.userType,
    })
  })

  // Disconnect
  socket.on("disconnect", (reason) => {
    connectedUsers.delete(socket.id)
    console.log(`[Chat] Disconnected: ${auth.userType}:${auth.userId} (${reason})`)
  })

  socket.on("error", (error) => {
    console.error(`[Chat] Socket error (${socket.id}):`, error)
  })
})

// ============================================
// Internal HTTP Endpoints
// (Called by Next.js API routes, not accessible via Caddy)
// ============================================

// Broadcast a new message to a room (server-side)
app.post("/internal/broadcast", (req: express.Request, res: express.Response) => {
  const { pedidoId, message } = req.body as { pedidoId?: string; message?: ChatMessage }

  if (!pedidoId || !message) {
    res.status(400).json({ error: "pedidoId and message are required" })
    return
  }

  io.to(`pedido:${pedidoId}`).emit("new-message", message)
  console.log(`[Chat] Internal broadcast to pedido:${pedidoId}: ${message.id}`)
  res.json({ ok: true })
})

// Broadcast unread count update (server-side)
app.post("/internal/unread-update", (req: express.Request, res: express.Response) => {
  const { userId, userType, count } = req.body as {
    userId?: string
    userType?: string
    count?: number
  }

  if (!userId || !userType) {
    res.status(400).json({ error: "userId and userType are required" })
    return
  }

  for (const [socketId, auth] of connectedUsers.entries()) {
    if (auth.userId === userId && auth.userType === userType) {
      io.to(socketId).emit("unread-update", { count: count || 0 })
    }
  }

  res.json({ ok: true })
})

// Health check
app.get("/internal/health", (_req: express.Request, res: express.Response) => {
  res.json({
    status: "ok",
    connections: connectedUsers.size,
    rooms: io.sockets.adapter.rooms.size,
  })
})

// ============================================
// Start Server
// ============================================
const PORT = 3003

httpServer.listen(PORT, () => {
  console.log(`[Chat Service] Running on port ${PORT}`)
  console.log(`[Chat Service] Socket.IO path: /socket.io/ (default)`)
  console.log(`[Chat Service] Internal API: http://localhost:${PORT}/internal/`)
})

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("[Chat Service] Received SIGTERM, shutting down...")
  httpServer.close(() => {
    console.log("[Chat Service] Server closed")
    process.exit(0)
  })
})

process.on("SIGINT", () => {
  console.log("[Chat Service] Received SIGINT, shutting down...")
  httpServer.close(() => {
    console.log("[Chat Service] Server closed")
    process.exit(0)
  })
})
