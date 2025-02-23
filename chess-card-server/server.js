require("dotenv").config();
const express = require("express");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const cors = require("cors");
const { Chess } = require('chess.js');

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
  currentTurn: { type: String, default: 'white' }
});

const Game = mongoose.model("Game", GameSchema);

// ------------------------------
// Auto-Match Endpoint: GET /match
// If a waiting game exists, return it. Otherwise, create a new game.
// ------------------------------
let waitingGame = null;

app.get("/match", async (req, res) => {
  try {
    if (waitingGame) {
      const game = await Game.findById(waitingGame);
      if (game && game.players < 2) {
        game.players += 1;
        await game.save();
        const gameData = game.toObject();
        waitingGame = null;
        return res.json(gameData);
      }
    }

    const newGame = await Game.create({ 
      players: 1,
      currentTurn: 'white'
    });
    waitingGame = newGame._id;
    res.json(newGame.toObject());
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
      
      if (clients.size <= 2) {
        const color = !game.whitePlayer ? 'white' : 'black';
        socket.playerColor = color;
        
        const update = {};
        if (color === 'white') {
          update.whitePlayer = socket.id;
        } else {
          update.blackPlayer = socket.id;
        }
        
        await Game.findByIdAndUpdate(gameId, update);
        
        console.log(`Player ${socket.id} assigned color: ${color}`);
        
        socket.data = { color: color, gameId: gameId };

        socket.emit("color-assignment", {
          color,
          message: `You are playing as ${color}`
        });

        if (clients.size === 2) {
          console.log(`Game ${gameId} starting with white: ${game.whitePlayer}, black: ${game.blackPlayer}`);
          io.to(gameId).emit("match-start", {
            message: "Game starting!",
            gameId,
            currentTurn: 'white'
          });
        }
      } else {
        socket.emit("error", "Game is full");
        socket.disconnect();
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

      // Log the FEN string for debugging
      console.log(`Received FEN: ${fen}`);

      const chess = new Chess();
      if (!chess.load(fen)) {
        console.error("Invalid FEN:", fen);
        socket.emit("error", "Invalid move");
        return;
      }

      const currentTurn = chess.turn() === 'w' ? 'white' : 'black';
      
      if (socket.playerColor !== currentTurn) {
        socket.emit("error", "Not your turn");
        return;
      }

      game.boardState = fen;
      game.currentTurn = chess.turn() === 'w' ? 'black' : 'white';
      await game.save();

      io.to(gameId).emit("update-board", {
        fen: fen,
        currentTurn: game.currentTurn
      });

      console.log(`Move made by ${socket.playerColor}, next turn: ${game.currentTurn}`);

    } catch (err) {
      console.error("Move error:", err);
      socket.emit("error", "Invalid move");
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));