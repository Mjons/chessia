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

    const newGame = await Game.create({ players: 1 });
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
      
      // Assign color
      if (clients.size <= 2) {
        const color = !game.whitePlayer ? 'white' : 'black';
        socket.playerColor = color;
        
        // Update game with player's color
        const update = {};
        if (color === 'white') {
          update.whitePlayer = socket.id;
        } else {
          update.blackPlayer = socket.id;
        }
        
        await Game.findByIdAndUpdate(gameId, update);

        console.log(`Player ${socket.id} assigned color: ${color}`);

        // Send color to client
        socket.emit("color-assignment", {
          color,
          message: `You are playing as ${color}`