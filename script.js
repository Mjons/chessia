const cardDeck = [
    { name: "Teleportation", effect: "moveAnyPieceAnywhere" },
    { name: "Shield", effect: "protectPiece" },
    { name: "Knight's Leap", effect: "moveLikeKnight" },
    { name: "Swap Sacrifice", effect: "swapPieces" }
  ];
  
  const playerHand = {
    white: [],
    black: []
  };
  
  const game = {
    chess: new Chess(),
    board: null,
    players: {
      white: { name: "White", tokens: 3 },
      black: { name: "Black", tokens: 3 }
    },
    protectedPiece: null,
    shieldActiveForPlayer: null,
    cardMode: null,
    cardPlayer: null,
    selectedPiece: null,
    swapFirstPiece: null,
    previousTurn: null,
    cardPlayedThisTurn: false,
    isSkippingTurn: false,
    newlyDrawnCards: {
        white: new Set(),
        black: new Set()
    },
  
    init() {
      console.log('Initializing chessboard...');
      this.board = Chessboard('board', {
        draggable: true,
        position: 'start',
        pieceTheme: 'img/chesspieces/custom/{piece}.png',
        onDragStart: this.onDragStart.bind(this),
        onDrop: this.onDrop.bind(this),
        onMouseoverSquare: this.onMouseoverSquare.bind(this),
        onMouseoutSquare: this.onMouseoutSquare.bind(this)
      });
      console.log('Chessboard initialized.');
      this.updateStatus();
      this.updateTokens();
      this.updateCardDisplay();
  
      // Add single click listener for all card modes
      const squares = document.querySelectorAll('.square-55d63');
      squares.forEach(square => {
        square.addEventListener('click', (e) => {
          if (this.cardMode === 'teleport') {
            this.handleTeleportClick(e);
          } else if (this.cardMode === 'shield') {
            this.handleShieldClick(this.cardPlayer, e);
          } else if (this.cardMode === 'knight') {
            this.handleKnightsLeapClick(this.cardPlayer, e);
          } else if (this.cardMode === 'swap') {
            this.handleSwapClick(e);
          }
        });
      });
  
      // Add skip turn button
      const skipTurnBtn = document.createElement('button');
      skipTurnBtn.id = 'skip-turn-btn';
      skipTurnBtn.className = 'help-button';
      skipTurnBtn.textContent = 'Skip Turn (Draw Card)';
      skipTurnBtn.onclick = () => {
        const currentPlayer = this.chess.turn() === 'w' ? 'white' : 'black';
        if (!this.cardPlayedThisTurn) {
          this.skipTurn(currentPlayer);
        } else {
          this.showMessage("You can't skip your turn after playing a card!");
        }
      };
      document.querySelector('.container').appendChild(skipTurnBtn);
  
      // Initialize the help section
      const helpButton = document.createElement('button');
      helpButton.id = 'toggle-help';
      helpButton.className = 'help-button';
      helpButton.textContent = 'Show Game Rules';
      helpButton.onclick = () => this.toggleCardHelp();
      
      const helpSection = document.createElement('div');
      helpSection.id = 'card-help';
      helpSection.className = 'hidden';
      helpSection.innerHTML = `
          <div class="help-section">
              <h3>Card Effects</h3>
              <ul>
                  <li><strong>Teleportation:</strong> Move any of your pieces to any empty square on the board. Ends your turn.</li>
                  <li><strong>Shield:</strong> Protect one of your pieces from capture until your next turn begins. Does NOT end your turn.</li>
                  <li><strong>Knight's Leap:</strong> Move any piece as if it were a knight (L-shape). Can capture pieces. Ends your turn.</li>
                  <li><strong>Swap Sacrifice:</strong> Swap the positions of any two of your pieces. Ends your turn.</li>
              </ul>
          </div>
          
          <div class="help-section">
              <h3>How to Draw Cards</h3>
              <p>You can draw a card (up to 3 cards max) by performing any of these actions:</p>
              <ul>
                  <li><strong>Check:</strong> Putting your opponent's king in check</li>
                  <li><strong>Promotion:</strong> Promoting a pawn to a stronger piece</li>
                  <li><strong>Castling:</strong> Performing a kingside or queenside castle</li>
                  <li><strong>Capture:</strong> Taking an opponent's piece</li>
                  <li><strong>Defense:</strong> Moving a piece to defend a threatened piece</li>
                  <li><strong>Fork:</strong> Attacking multiple pieces at once</li>
                  <li><strong>Pin:</strong> Pinning an opponent's piece against their king</li>
                  <li><strong>Skip Turn:</strong> Choose to skip your turn instead of moving</li>
              </ul>
              <p><em>Note: You can only hold up to 3 cards at a time.</em></p>
          </div>
      `;
      
      const helpContainer = document.createElement('div');
      helpContainer.id = 'card-help-container';
      helpContainer.appendChild(helpButton);
      helpContainer.appendChild(helpSection);
      
      document.querySelector('.container').appendChild(helpContainer);
    },
  
    onDragStart(source, piece) {
      if (this.cardMode) return false;
      if (this.chess.game_over()) return false;
      if ((this.chess.turn() === 'w' && piece.search(/^b/) !== -1) ||
          (this.chess.turn() === 'b' && piece.search(/^w/) !== -1)) {
        return false;
      }
      return true;
    },
  
    onDrop(source, target) {
        if (this.cardMode) return;
      
        const move = this.chess.move({ from: source, to: target, promotion: 'q' });
        if (!move) return 'snapback';
      
        const currentPlayer = this.chess.turn() === 'w' ? 'black' : 'white'; // Player who just moved
        const opponent = currentPlayer === 'white' ? 'black' : 'white';
      
        if (move.captured && this.protectedPiece === target && this.shieldActiveForPlayer === opponent) {
          this.chess.undo();
          console.log(`Move blocked: ${opponent}'s piece at ${target} is shielded!`);
          return 'snapback';
        }
      
        this.drawCard(currentPlayer);
        if (move.captured) {
          this.drawCard(currentPlayer);
          document.getElementById('capture-sound').play();
        } else {
          document.getElementById('move-sound').play();
        }
      
        this.board.position(this.chess.fen());
        this.updateStatus();
        this.updateCardDisplay();

        if (move !== null) {
            // Clear newly drawn cards for the player who just started their turn
            const nextPlayer = this.chess.turn() === 'w' ? 'white' : 'black';
            this.clearNewlyDrawnCards(nextPlayer);
        }
    },
  
    drawCard(player) {
      if (cardDeck.length === 0) return;
      
      const lastMove = this.chess.history({verbose: true}).pop();
      if (!lastMove && !this.isSkippingTurn) return;
      
      let shouldDrawCard = false;
      const reasons = [];

      // Skip turn condition
      if (this.isSkippingTurn) {
        shouldDrawCard = true;
        reasons.push("skipping turn");
        this.isSkippingTurn = false; // Reset the flag
      }
      // Only check other conditions if not skipping turn
      else if (lastMove) {
        // Check for check
        if (this.chess.in_check()) {
          shouldDrawCard = true;
          reasons.push("putting opponent in check");
        }
        
        // Check for pawn promotion
        if (lastMove.flags.includes('p')) {
          shouldDrawCard = true;
          reasons.push("promoting a pawn");
        }
        
        // Check for castling
        if (lastMove.flags.includes('k') || lastMove.flags.includes('q')) {
          shouldDrawCard = true;
          reasons.push("castling");
        }
        
        // Check for capture
        if (lastMove.captured) {
          shouldDrawCard = true;
          reasons.push("capturing a piece");
        }
        
        // Check for defending a threatened piece
        if (this.isDefendingMove(lastMove)) {
          shouldDrawCard = true;
          reasons.push("defending a threatened piece");
        }
        
        // Check for fork
        if (this.isForking(lastMove)) {
          shouldDrawCard = true;
          reasons.push("creating a fork");
        }
        
        // Check for pin
        if (this.isPinning(lastMove)) {
          shouldDrawCard = true;
          reasons.push("pinning an opponent's piece");
        }
      }

      if (shouldDrawCard && playerHand[player].length < 3) {
        const randomIndex = Math.floor(Math.random() * cardDeck.length);
        const card = cardDeck[randomIndex];
        const cardIndex = playerHand[player].length;  // Index where the card will be added
        playerHand[player].push(card);
        
        // Mark this card as newly drawn
        this.newlyDrawnCards[player].add(cardIndex);
        
        this.showMessage(`${player} drew ${card.name} for ${reasons.join(" and ")}. Card can be used next turn.`);
        this.updateCardDisplay();
      }
    },
  
    playCard(player, cardIndex) {
        if (this.cardPlayedThisTurn) {
            this.showMessage("You can only play one card per turn!");
            return;
        }
        if (this.cardMode) {
            this.showMessage(`Clearing previous card mode: ${this.cardMode}`);
            this.resetCardMode();
        }
        this.pendingCard = { player, cardIndex };
        const card = playerHand[player][cardIndex];
        this.cardPlayer = player;

        // Check if it's the player's turn
        const currentTurn = this.chess.turn() === 'w' ? 'white' : 'black';
        if (player !== currentTurn) {
            this.showMessage(`You can only play cards during your turn! Current turn: ${currentTurn}`);
            return;
        }

        // Check if this is a newly drawn card
        if (this.newlyDrawnCards[player].has(cardIndex)) {
            this.showMessage("Newly drawn cards can't be used until your next turn!");
            return;
        }

        switch (card.effect) {
            case "moveAnyPieceAnywhere": // Teleportation
                this.showMessage(`${player}'s turn: Teleportation activated! Click a piece to teleport, then a destination.`);
                this.enableTeleportation(player);
                break;
            case "moveLikeKnight": // Knight's Leap
                this.showMessage(`${player}'s turn: Knight's Leap activated! Click a piece to move like a knight, then a destination.`);
                this.enableKnightsLeap(player);
                break;
            case "protectPiece": // Shield
                this.showMessage(`${player}'s turn: Shield activated! Click a piece to protect it.`);
                this.enableShield(player);
                break;
            case "swapPieces": // Swap Sacrifice
                this.showMessage(`${player}'s turn: Swap activated! Click first piece to swap, then the second piece.`);
                this.enableSwap(player);
                break;
            default:
                this.showMessage(`Card effect ${card.effect} not implemented.`);
                this.pendingCard = null;
                return;
        }
        if (this.cardMode) {
            document.getElementById('cancel-card-action').style.display = 'block';
        }
    },
  
    // **New Function: Cancel Card Action**
    cancelCardAction() {
        this.resetCardMode();
        this.showMessage("Card action canceled. You can choose another card or make a normal move.");
      },
  
    enableTeleportation(player) {
      this.cardMode = 'teleport';
      this.selectedPiece = null;
      this.highlightPlayerPieces(player);
    },
  
    showMessage(message) {
      console.log(message);
      const messageLog = document.getElementById('message-log');
      const messageElement = document.createElement('p');
      messageElement.textContent = message;
      if (messageLog.firstChild) {
        messageLog.insertBefore(messageElement, messageLog.firstChild);
      } else {
        messageLog.appendChild(messageElement);
      }
      const maxMessages = 5;
      while (messageLog.children.length > maxMessages) {
        messageLog.removeChild(messageLog.lastChild);
      }
    },
  
    handleTeleportClick(event) {
      const square = event.target.closest('.square-55d63');
      if (!square) return;
      
      const position = square.dataset.square;
      if (!position) return;
      
      if (!this.selectedPiece) {
        const piece = this.chess.get(position);
        if (piece && piece.color === (this.cardPlayer === 'white' ? 'w' : 'b')) {
          this.selectedPiece = position;
          this.highlightEmptySquares();
          this.showMessage(`Selected ${piece.type} at ${position}. Now click an empty square for destination.`);
        }
      } else {
        const success = this.teleportPiece(this.cardPlayer, this.selectedPiece, position);
        if (success) {
          playerHand[this.pendingCard.player].splice(this.pendingCard.cardIndex, 1);
          this.updateCardDisplay();
          this.cardPlayedThisTurn = true;
          this.resetCardMode();
          
          const nextPlayer = this.cardPlayer === 'white' ? 'black' : 'white';
          const newFen = this.chess.fen().replace(/ w | b /, ` ${nextPlayer === 'white' ? 'w' : 'b'} `);
          this.chess.load(newFen);
          
          this.board.position(this.chess.fen());
          this.updateStatus();
          this.lockBoard();
          this.showMessage(`${this.cardPlayer}'s teleport complete. ${nextPlayer}'s turn.`);
        }
      }
    },
  
    teleportPiece(player, source, target) {
      const piece = this.chess.get(source);
      if (!piece) return false;
    
      // Check if target square is occupied
      const targetPiece = this.chess.get(target);
      if (targetPiece) {
        this.showMessage("Can only teleport to empty squares!");
        return false;
      }
    
      // Perform the teleport
      this.chess.remove(source);
      this.chess.put(piece, target);
    
      if (this.chess.in_check()) {
        this.chess.remove(target);
        this.chess.put(piece, source);
        console.log("Invalid teleportation: cannot leave king in check.");
        return false;
      } else {
        document.getElementById('move-sound').play();
        console.log(`${player} teleported ${piece.type} from ${source} to ${target}. Turn ends.`);
        return true;
      }
    },
  
    enableShield(player) {
      this.cardMode = 'shield';
      this.selectedPiece = null;
      this.highlightPlayerPieces(player);
    },
  
    handleShieldClick(player, event) {
        const square = event.target.closest('.square-55d63');
        if (!square) return;
      
        const position = square.dataset.square;
        const piece = this.chess.get(position);
        
        if (piece && piece.color === (player === 'white' ? 'w' : 'b')) {
            this.applyShield(player, position);
        } else {
            this.showMessage("You can only shield your own pieces!");
        }
      },
  
    enableKnightsLeap(player) {
      this.cardMode = 'knight';
      this.selectedPiece = null;
      this.highlightPlayerPieces(player);
    },
  
    handleKnightsLeapClick(player, event) {
        const square = event.target.closest('.square-55d63');
        if (!square) return;
      
        const position = square.dataset.square;
      
        if (!this.selectedPiece) {
            const piece = this.chess.get(position);
            if (piece && piece.color === (player === 'white' ? 'w' : 'b')) {
                this.selectedPiece = position;
                this.highlightKnightMoves(position);
                this.showMessage(`${player} selected ${piece.type} at ${position}. Now click a knight-move destination.`);
            }
        } else {
            if (this.isKnightMove(this.selectedPiece, position)) {
                const success = this.moveLikeKnight(player, this.selectedPiece, position);
                if (success) {
                    playerHand[this.pendingCard.player].splice(this.pendingCard.cardIndex, 1);
                    this.updateCardDisplay();
                    this.cardPlayedThisTurn = true;
                    this.resetCardMode();
                    
                    const nextPlayer = player === 'white' ? 'black' : 'white';
                    const newFen = this.chess.fen().replace(/ w | b /, ` ${nextPlayer === 'white' ? 'w' : 'b'} `);
                    this.chess.load(newFen);
                    
                    this.board.position(this.chess.fen());
                    this.updateStatus();
                    this.lockBoard();
                    this.showMessage(`${player}'s Knight's Leap complete. ${nextPlayer}'s turn.`);
                }
            } else {
                this.showMessage(`${player} tried an invalid knight move to ${position}. Select a valid knight-move square.`);
                this.highlightKnightMoves(this.selectedPiece);
            }
        }
    },
  
      moveLikeKnight(player, source, target) {
        const piece = this.chess.get(source);
        if (!piece) return false;
      
        const targetPiece = this.chess.get(target);
        const opponent = player === 'white' ? 'black' : 'white';
        if (targetPiece && this.protectedPiece === target && this.shieldActiveForPlayer === opponent) {
          this.showMessage(`Knight's Leap blocked: ${opponent}'s piece at ${target} is shielded!`);
          return false;
        }
      
        const originalTargetPiece = targetPiece;
        this.chess.remove(source);
        this.chess.put(piece, target);
      
        if (this.chess.in_check()) {
          this.chess.remove(target);
          if (originalTargetPiece) this.chess.put(originalTargetPiece, target);
          this.chess.put(piece, source);
          this.showMessage("Invalid knight's leap: cannot leave king in check.");
          return false;
        } else {
          if (originalTargetPiece && originalTargetPiece.color !== piece.color) {
            this.showMessage(`${player} captured ${originalTargetPiece.type} at ${target} with Knight's Leap!`);
            document.getElementById('capture-sound').play();
          } else {
            document.getElementById('move-sound').play();
          }

          // Force turn change
          const nextPlayer = player === 'white' ? 'black' : 'white';
          const newFen = this.chess.fen().replace(/ w | b /, ` ${nextPlayer === 'white' ? 'w' : 'b'} `);
          this.chess.load(newFen);
          
          this.showMessage(`${player} moved ${piece.type} like a knight from ${source} to ${target}. ${nextPlayer}'s turn.`);
          return true;
        }
      },
  
    enableSwap(player) {
      this.cardMode = 'swap';
      this.selectedPiece = null;
      this.swapFirstPiece = null;
      this.highlightPlayerPieces(player);
    },
  
    handleSwapClick(event) {
        const square = event.target.closest('.square-55d63');
        if (!square) return;
        const position = square.dataset.square;
      
        if (!this.swapFirstPiece) {
          const piece = this.chess.get(position);
          if (piece && piece.color === (this.cardPlayer === 'white' ? 'w' : 'b')) {
            this.swapFirstPiece = position;
            this.highlightPlayerPieces(this.cardPlayer);
            this.showMessage(`${this.cardPlayer} selected ${piece.type} at ${position}. Now click the second piece to swap.`);
          }
        } else {
          const success = this.swapPieces(this.cardPlayer, this.swapFirstPiece, position);
          if (success) {
            playerHand[this.pendingCard.player].splice(this.pendingCard.cardIndex, 1);
            this.updateCardDisplay();
            this.cardPlayedThisTurn = true;
            this.resetCardMode();
            
            const nextPlayer = this.cardPlayer === 'white' ? 'black' : 'white';
            const newFen = this.chess.fen().replace(/ w | b /, ` ${nextPlayer === 'white' ? 'w' : 'b'} `);
            this.chess.load(newFen);
            
            this.board.position(this.chess.fen());
            this.updateStatus();
            this.lockBoard();
            this.showMessage(`${this.cardPlayer}'s swap complete. ${nextPlayer}'s turn.`);
          }
        }
      },
      
      swapPieces(player, source, target) {
        const piece1 = this.chess.get(source);
        const piece2 = this.chess.get(target);
        if (piece1 && piece2 && piece1.color === piece2.color) {
            // Store original positions
            const originalPiece1 = piece1;
            const originalPiece2 = piece2;
            
            // Perform the swap
            this.chess.remove(source);
            this.chess.remove(target);
            this.chess.put(originalPiece1, target);
            this.chess.put(originalPiece2, source);
            
            // Check if the swap leaves the king in check
            if (this.chess.in_check()) {
                // Undo the swap if it leaves the king in check
                this.chess.remove(source);
                this.chess.remove(target);
                this.chess.put(originalPiece1, source);
                this.chess.put(originalPiece2, target);
                this.showMessage("Cannot swap pieces: would leave king in check!");
                return false;
            }
            
            this.board.position(this.chess.fen());
            document.getElementById('move-sound').play();
            
            // Force turn change
            const nextPlayer = player === 'white' ? 'black' : 'white';
            const newFen = this.chess.fen().replace(/ w | b /, ` ${nextPlayer === 'white' ? 'w' : 'b'} `);
            this.chess.load(newFen);
            
            this.showMessage(`${player} swapped ${piece1.type} at ${source} with ${piece2.type} at ${target}. ${nextPlayer}'s turn.`);
            return true;
        } else {
            this.showMessage("Can only swap pieces of the same color!");
            this.swapFirstPiece = null;
            this.highlightPlayerPieces(player);
            return false;
        }
      },
  
    applyShield(player, square) {
      const piece = this.chess.get(square);
      if (piece && piece.color === (player === 'white' ? 'w' : 'b')) {
        // Remove previous shield if exists
        if (this.protectedPiece) {
          const oldSquare = document.querySelector(`.square-${this.protectedPiece}`);
          if (oldSquare) {
            oldSquare.classList.remove('shield-active');
          }
        }

        this.protectedPiece = square;
        this.shieldActiveForPlayer = player;
        
        // Add visual feedback
        const squareElement = document.querySelector(`.square-${square}`);
        if (squareElement) {
          squareElement.classList.add('shield-active');
          squareElement.classList.add('shield-animation');
          setTimeout(() => {
            squareElement.classList.remove('shield-animation');
          }, 1000);
        }
        
        this.showMessage(`${player} protected piece at ${square} until their next turn begins.`);
        
        // Complete the card action but DON'T end turn
        playerHand[this.pendingCard.player].splice(this.pendingCard.cardIndex, 1);
        this.updateCardDisplay();
        this.cardPlayedThisTurn = true;
        this.resetCardMode();
        this.board.position(this.chess.fen());
        this.updateStatus();
      }
    },
  
    isKnightMove(source, target) {
      const sourceX = source.charCodeAt(0) - 'a'.charCodeAt(0);
      const sourceY = parseInt(source[1]) - 1;
      const targetX = target.charCodeAt(0) - 'a'.charCodeAt(0);
      const targetY = parseInt(target[1]) - 1;
      const dx = Math.abs(targetX - sourceX);
      const dy = Math.abs(targetY - sourceY);
      return (dx === 2 && dy === 1) || (dx === 1 && dy === 2);
    },
  
    advanceTurn() {
      const currentTurn = this.chess.turn();
      this.chess.load(this.chess.fen(), true);
      this.chess.load(`${this.chess.fen().split(' ')[0]} ${currentTurn === 'w' ? 'b' : 'w'} ${this.chess.fen().split(' ')[2]} ${this.chess.fen().split(' ')[3]} ${this.chess.fen().split(' ')[4]} ${parseInt(this.chess.fen().split(' ')[5]) + 1}`, true);
    },
  
    lockBoard() {
      this.board.draggable = false;
      setTimeout(() => {
        this.board.draggable = true;
      }, 100);
    },
  
    highlightPlayerPieces(player) {
      const squares = document.querySelectorAll('.square-55d63');
      squares.forEach(square => {
        const piece = this.chess.get(square.dataset.square);
        if (piece && piece.color === (player === 'white' ? 'w' : 'b')) {
          square.classList.add('highlight');
        } else {
          square.classList.remove('highlight');
        }
      });
    },
  
    highlightAllSquares() {
      const squares = document.querySelectorAll('.square-55d63');
      squares.forEach(square => square.classList.add('highlight'));
    },
  
    highlightKnightMoves(source) {
      const sourceX = source.charCodeAt(0) - 'a'.charCodeAt(0);
      const sourceY = parseInt(source[1]) - 1;
      const knightMoves = [
        [2, 1], [2, -1], [-2, 1], [-2, -1],
        [1, 2], [1, -2], [-1, 2], [-1, -2]
      ];
  
      const squares = document.querySelectorAll('.square-55d63');
      squares.forEach(square => square.classList.remove('highlight'));
  
      knightMoves.forEach(([dx, dy]) => {
        const targetX = sourceX + dx;
        const targetY = sourceY + dy;
        if (targetX >= 0 && targetX < 8 && targetY >= 0 && targetY < 8) {
          const targetSquare = String.fromCharCode('a'.charCodeAt(0) + targetX) + (targetY + 1);
          const squareElement = document.querySelector(`.square-${targetSquare}`);
          if (squareElement) {
            squareElement.classList.add('highlight');
          }
        }
      });
    },
  
    resetCardMode() {
        this.cardMode = null;
        this.cardPlayer = null;
        this.selectedPiece = null;
        this.pendingCard = null;
        const squares = document.querySelectorAll('.square-55d63');
        squares.forEach(square => {
          square.classList.remove('highlight');
        });
        this.board.draggable = true;
        document.getElementById('cancel-card-action').style.display = 'none';
      },
  
    onMouseoverSquare(square, piece) {
      if (this.cardMode === 'shield' && piece) {
        document.querySelector(`.square-${square}`).classList.add('highlight');
      }
    },
  
    onMouseoutSquare(square, piece) {
      if (this.cardMode === 'shield' && this.protectedPiece !== square) {
        document.querySelector(`.square-${square}`).classList.remove('highlight');
      }
    },
  
    updateStatus() {
        let status = '';
        if (this.chess.in_checkmate()) {
          status = `Checkmate! ${this.chess.turn() === 'w' ? 'Black' : 'White'} wins!`;
          this.showMessage(status);
        } else if (this.chess.in_stalemate()) {
          status = 'Stalemate! Draw!';
          this.showMessage(status);
        } else {
          const turn = this.chess.turn() === 'w' ? 'White' : 'Black';
          status = `${turn}'s turn${this.chess.in_check() ? ' - Check!' : ''}`;
          if (this.chess.in_check()) {
            this.showMessage(`${turn} is in check!`);
          }
        }
        document.getElementById('status').textContent = status;
      
        const currentTurn = this.chess.turn() === 'w' ? 'white' : 'black';
      
        if (this.previousTurn !== currentTurn) {
          this.cardPlayedThisTurn = false;
          
          // Deactivate shield and remove visual indication
          if (this.shieldActiveForPlayer && this.shieldActiveForPlayer === currentTurn) {
            const squareElement = document.querySelector(`.square-${this.protectedPiece}`);
            if (squareElement) {
              squareElement.classList.remove('shield-active');
            }
            this.showMessage(`Shield deactivated for ${this.shieldActiveForPlayer} as their turn begins.`);
            this.protectedPiece = null;
            this.shieldActiveForPlayer = null;
          }
        }
      
        this.previousTurn = currentTurn;
      },
  
    updateTokens() {
      document.getElementById('white-tokens').textContent = `White: ${this.players.white.tokens} tokens`;
      document.getElementById('black-tokens').textContent = `Black: ${this.players.black.tokens} tokens`;
    },
  
    updateCardDisplay() {
      const whiteHand = document.getElementById('white-hand');
      const blackHand = document.getElementById('black-hand');
      whiteHand.innerHTML = '';
      blackHand.innerHTML = '';
      
      const currentTurn = this.chess.turn() === 'w' ? 'white' : 'black';

      // Create white's cards
      playerHand.white.forEach((card, index) => {
          const button = document.createElement('button');
          button.textContent = card.name;
          button.onclick = () => this.playCard('white', index);
          
          // Disable if it's not white's turn or if it's a newly drawn card
          button.disabled = currentTurn !== 'white' || this.newlyDrawnCards.white.has(index);
          if (this.newlyDrawnCards.white.has(index)) {
              button.classList.add('newly-drawn');
              button.title = "Available next turn";
          }
          whiteHand.appendChild(button);
      });

      // Create black's cards
      playerHand.black.forEach((card, index) => {
          const button = document.createElement('button');
          button.textContent = card.name;
          button.onclick = () => this.playCard('black', index);
          
          // Disable if it's not black's turn or if it's a newly drawn card
          button.disabled = currentTurn !== 'black' || this.newlyDrawnCards.black.has(index);
          if (this.newlyDrawnCards.black.has(index)) {
              button.classList.add('newly-drawn');
              button.title = "Available next turn";
          }
          blackHand.appendChild(button);
      });
    },
  
    completeCardAction() {
      if (this.pendingCard) {
        playerHand[this.pendingCard.player].splice(this.pendingCard.cardIndex, 1);
        this.updateCardDisplay();
        this.cardPlayedThisTurn = true;
        this.resetCardMode();
        this.advanceTurn();
        this.board.position(this.chess.fen());
        this.updateStatus();
        this.lockBoard();
      }
    },
  
    // Add new function to highlight only empty squares
    highlightEmptySquares() {
      const squares = document.querySelectorAll('.square-55d63');
      squares.forEach(square => {
        const position = square.dataset.square;
        if (position && !this.chess.get(position)) {
          square.classList.add('highlight');
        } else {
          square.classList.remove('highlight');
        }
      });
    },
  
    // Helper functions for checking conditions
    isDefendingMove(move) {
      const fen = this.chess.fen();
      this.chess.undo();
      
      // Get all pieces under attack before the move
      const threatenedBefore = this.getThreatenedPieces(move.color);
      
      this.chess.load(fen);
      const threatenedAfter = this.getThreatenedPieces(move.color);
      
      // Move is defensive if it reduces the number of threatened pieces
      return threatenedAfter.length < threatenedBefore.length;
    },
  
    getThreatenedPieces(color) {
      const threatened = [];
      for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
          const square = String.fromCharCode('a'.charCodeAt(0) + col) + (row + 1);
          const piece = this.chess.get(square);
          if (piece && piece.color === color) {
            if (this.isSquareAttacked(square, color === 'w' ? 'b' : 'w')) {
              threatened.push(square);
            }
          }
        }
      }
      return threatened;
    },
  
    isSquareAttacked(square, byColor) {
      const moves = this.chess.moves({ verbose: true });
      return moves.some(move => 
        move.to === square && 
        this.chess.get(move.from)?.color === byColor
      );
    },
  
    isForking(move) {
      const moves = this.chess.moves({ square: move.to, verbose: true });
      const attackedPieces = moves.filter(m => this.chess.get(m.to)?.color !== this.chess.get(move.to)?.color);
      return attackedPieces.length >= 2;
    },
  
    isPinning(move) {
      const piece = this.chess.get(move.to);
      if (!piece) return false;
      
      // Store current position
      const fen = this.chess.fen();
      
      // Remove the pinning piece
      this.chess.remove(move.to);
      
      // Count legal moves for opponent before
      const movesBefore = this.chess.moves().length;
      
      // Restore position
      this.chess.load(fen);
      
      // If removing the piece increases legal moves, it was pinning something
      return this.chess.moves().length < movesBefore;
    },
  
    // Add function to handle skipping turn
    skipTurn(player) {
      this.isSkippingTurn = true;
      this.drawCard(player);
      
      // Switch to other player's turn
      const nextPlayer = player === 'white' ? 'black' : 'white';
      this.chess.load(this.chess.fen().replace(/ w | b /, ` ${nextPlayer === 'white' ? 'w' : 'b'} `));
      
      // Clear newly drawn cards for the next player
      this.clearNewlyDrawnCards(nextPlayer);
      
      this.board.position(this.chess.fen());
      this.updateStatus();
      this.showMessage(`${player} skipped their turn and drew a card. ${nextPlayer}'s turn.`);
    },
  
    toggleCardHelp() {
      const helpSection = document.getElementById('card-help');
      if (helpSection.className === 'hidden') {
        helpSection.className = '';
      } else {
        helpSection.className = 'hidden';
      }
    },
  
    // Add function to clear newly drawn cards at the start of a player's turn
    clearNewlyDrawnCards(player) {
        this.newlyDrawnCards[player].clear();
    },
  
    // Update endCurrentTurn to clear newly drawn cards for the next player
    endCurrentTurn() {
        const currentPlayer = this.cardPlayer;
        const nextPlayer = currentPlayer === 'white' ? 'black' : 'white';
        
        // Switch the turn in the chess engine
        this.chess.load(this.chess.fen().replace(/ w | b /, ` ${nextPlayer === 'white' ? 'w' : 'b'} `));
        
        // Clear newly drawn cards for the next player
        this.clearNewlyDrawnCards(nextPlayer);
        
        // Update the board
        this.board.position(this.chess.fen());
        
        // Clean up the card use
        playerHand[currentPlayer].splice(this.pendingCard.cardIndex, 1);
        this.updateCardDisplay();
        this.cardPlayedThisTurn = true;
        this.resetCardMode();
        
        // Clear any highlights
        const squares = document.querySelectorAll('.square-55d63');
        squares.forEach(sq => sq.classList.remove('highlight'));
        
        // Update game state
        this.updateStatus();
        this.lockBoard();
        
        this.showMessage(`${nextPlayer}'s turn.`);
    }
  };
  
  // Initialize the game
  game.init();