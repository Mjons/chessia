// server.js

require("dotenv").config();
const express = require("express");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const cors = require("cors");
const { Chess } = require("chess.js");

// Initialize Express
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// Serve static files from "public" folder
app.use(express.static(path.join(__dirname, "public")));

// ------------------------------
// MongoDB Connection
// ------------------------------
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("❌ MongoDB connection error:", err));

// ------------------------------
// Game Model
// ------------------------------
const GameSchema = new mongoose.Schema({
  boardState: { type: String, default: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1" },
  whitePlayer: String,
  blackPlayer: String,
  players: { type: Number, default: 0 },
  currentTurn: { type: String, default: "white" },
  playerHands: {
    white: { type: Array, default: [] },
    black: { type: Array, default: [] }
  }
});

const Game = mongoose.model("Game", GameSchema);

// ------------------------------
// Auto-Match Endpoint: GET /match
// ------------------------------
app.get("/match", async (req, res) => {
  try {
    // Look for a game with only one player
    let game = await Game.findOne({ players: 1 });
    if (game) {
      game.players = 2;
      game.blackPlayer = null; // Will be set via socket
      await game.save();
      console.log(`Joining existing game ${game._id} with 2 players`);
      return res.json(game.toObject());
    }

    // If no waiting game, create a new one
    game = await Game.create({
      players: 1,
      whitePlayer: null, // Will be set via socket
      blackPlayer: null,
      currentTurn: "white",
      boardState: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      playerHands: { white: [], black: [] }
    });
    console.log(`Created new game ${game._id} with 1 player`);
    res.json(game.toObject());
  } catch (err) {
    console.error("Match error:", err);
    res.status(500).json({ error: "Failed to create/join game" });
  }
});

// ------------------------------
// GET /game/:id to return game state
// ------------------------------
app.get("/game/:id", async (req, res) => {
  try {
    const game = await Game.findById(req.params.id);
    if (!game) return res.status(404).json({ error: "Game not found" });
    res.json(game);
  } catch (err) {
    console.error("Game fetch error:", err);
    res.status(500).json({ error: "Failed to get game" });
  }
});

// ------------------------------
// Socket.io Integration
// ------------------------------
io.on("connection", (socket) => {
  console.log("Player connected:", socket.id);

  socket.on("join-game", async (gameId) => {
    try {
      const game = await Game.findById(gameId);
      if (!game) {
        socket.emit("error", "Game not found");
        return;
      }

      socket.join(gameId);
      const clients = await io.in(gameId).allSockets();

      if (clients.size > 2) {
        socket.emit("error", "Game is full");
        socket.disconnect();
        return;
      }

      // Assign color based on current game state
      let color;
      if (!game.whitePlayer) {
        color = "white";
        game.whitePlayer = socket.id;
      } else if (!game.blackPlayer && game.whitePlayer !== socket.id) {
        color = "black";
        game.blackPlayer = socket.id;
      } else {
        socket.emit("error", "You are already in this game");
        return;
      }

      await game.save();

      socket.playerColor = color;
      socket.data = { color, gameId };

      console.log(`Player ${socket.id} joined game ${gameId} as ${color}`);

      socket.emit("color-assignment", {
        color,
        message: `You are playing as ${color}`
      });

      // When both players are present, start the game
      if (game.players === 2 && game.whitePlayer && game.blackPlayer) {
        console.log(`Game ${gameId} starting - White: ${game.whitePlayer}, Black: ${game.blackPlayer}`);
        io.to(gameId).emit("match-start", {
          message: "Game starting!",
          gameId,
          currentTurn: "white",
          fen: game.boardState
        });
      } else {
        socket.emit("waiting", {
          message: "Waiting for opponent..."
        });
      }
    } catch (err) {
      console.error("Join error:", err);
      socket.emit("error", "Failed to join game");
    }
  });

  socket.on("move-piece", async ({ gameId, fen }) => {
    try {
      const game = await Game.findById(gameId);
      if (!game) {
        socket.emit("error", "Game not found");
        return;
      }

      console.log(`Received move from ${socket.id} (${socket.playerColor}): ${fen}`);

      const chess = new Chess();
      if (!chess.load(fen)) {
        console.error("Invalid FEN:", fen);
        socket.emit("error", "Invalid move - FEN validation failed");
        return;
      }

      // Verify it's the player's turn
      const currentTurn = chess.turn() === "w" ? "white" : "black";
      if (socket.playerColor !== currentTurn) {
        socket.emit("error", "Not your turn");
        return;
      }

      // Check if move is legal from previous state
      const prevChess = new Chess(game.boardState);
      const moves = prevChess.moves({ verbose: true });
      const moveNotation = fen.split(" ")[0].match(/([a-h][1-8]){2}/)?.[0];
      const lastMove = moves.find(m => m.from + m.to === moveNotation);
      if (!lastMove && !fen.includes("card")) { // Allow card moves to bypass for now
        console.error("Illegal move from previous state:", fen);
        socket.emit("error", "Illegal move");
        return;
      }

      // Update game state
      game.boardState = fen;
      game.currentTurn = currentTurn === "white" ? "black" : "white"; // Switch turn
      await game.save();

      console.log(`Move accepted. New turn: ${game.currentTurn}, FEN: ${fen}`);

      // Broadcast to all players in the room
      io.to(gameId).emit("update-board", {
        fen,
        currentTurn: game.currentTurn
      });

    } catch (err) {
      console.error("Move error:", err);
      socket.emit("error", "Server error processing move");
    }
  });

  socket.on("disconnecting", async () => {
    try {
      for (const room of socket.rooms) {
        if (room !== socket.id) {
          const game = await Game.findById(room);
          if (game) {
            const update = {
              players: game.players - 1
            };
            if (game.whitePlayer === socket.id) update.whitePlayer = null;
            if (game.blackPlayer === socket.id) update.blackPlayer = null;

            await Game.findByIdAndUpdate(room, update);

            io.to(room).emit("opponent-disconnected", {
              message: "Opponent disconnected"
            });
          }
        }
      }
    } catch (err) {
      console.error("Disconnect error:", err);
    }
  });
});

// ------------------------------
// Start Server
// ------------------------------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));