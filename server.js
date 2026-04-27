const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" } 
});

let currentGameId = null;
let currentRoundId = null;

const db = new sqlite3.Database('./poker.db', (err) => {
    if (err) {
        console.error("Database connection error:", err.message);
    } else {
        console.log('Connected to the poker SQLite database.');
        db.run('PRAGMA foreign_keys = ON;');
        
        db.serialize(() => {
            db.run(`CREATE TABLE IF NOT EXISTS game (
                game_id INTEGER PRIMARY KEY AUTOINCREMENT,
                start_time INTEGER
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS user (
                user_id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS user_game (
                user_id INTEGER,
                game_id INTEGER,
                buy_ins INTEGER,
                PRIMARY KEY (user_id, game_id),
                FOREIGN KEY (user_id) REFERENCES user(user_id),
                FOREIGN KEY (game_id) REFERENCES game(game_id)
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS round (
                round_id INTEGER PRIMARY KEY AUTOINCREMENT,
                game_id INTEGER,
                timestamp INTEGER,
                community_cards TEXT,
                FOREIGN KEY (game_id) REFERENCES game(game_id)
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS round_hand (
                round_id INTEGER,
                user_id INTEGER,
                hand_type TEXT,
                PRIMARY KEY (round_id, user_id),
                FOREIGN KEY (round_id) REFERENCES round(round_id),
                FOREIGN KEY (user_id) REFERENCES user(user_id)
            )`);

            db.run('INSERT INTO game (start_time) VALUES (?)', [Date.now()], function(err) {
                if (err) console.error("Failed to create game:", err.message);
                else {
                    currentGameId = this.lastID;
                    console.log(`New Game Started in DB (Game ID: ${currentGameId})`);
                }
            });
        });
    }
});

app.get('/api/games', (req, res) => {
    db.all('SELECT * FROM game', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/api/users/:username', (req, res) => {
    db.get('SELECT * FROM user WHERE username = ?', [req.params.username], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(row || { error: "User not found" });
    });
});

let cardranks = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];
let cardsuits = ['♠', '♥', '♦', '♣'];

function getNewDeck() {
    let deck = [];
    for (let suit of cardsuits) {
        for (let rank of cardranks) {
            deck.push({ rank: rank, suit: suit });
        }
    }
    return deck;
}

// Fisher-Yates shuffle
function shuffleDeck(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
}

let connectedPlayerIDs = [];
let currentRoundDeck = [];
let playerHands = new Map();
let roundInProgress = false;
let currentStreet = 'idle';
let communityCards = [];
const TOTAL_SEATS = 8;
let seatAssignments = Array(TOTAL_SEATS).fill(null);
let playerSeats = new Map();
let playerProfiles = new Map();

function getHostId() {
    return connectedPlayerIDs[0] ?? null;
}

function isValidSeatNumber(seatNumber) {
    return Number.isInteger(seatNumber) && seatNumber >= 1 && seatNumber <= TOTAL_SEATS;
}

function normalizePasswordValue(value) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    const hasWrappingSingleQuotes = trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2;
    const hasWrappingDoubleQuotes = trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2;

    if (hasWrappingSingleQuotes || hasWrappingDoubleQuotes) {
        return trimmed.slice(1, -1).trim();
    }

    return trimmed;
}

function getPlayersInSeatOrder() {
    return seatAssignments.filter(playerId => Boolean(playerId));
}

function clearPlayerSeat(playerId) {
    const seatNumber = playerSeats.get(playerId);
    if (!seatNumber) return;

    seatAssignments[seatNumber - 1] = null;
    playerSeats.delete(playerId);
    playerProfiles.delete(playerId);
}

function getSeatStates() {
    return seatAssignments.map((playerId) => {
        if (!playerId) return null;
        const playerProfile = playerProfiles.get(playerId) || {};
        return {
            playerId,
            name: playerProfile.name || null,
            chips: typeof playerProfile.chips === 'number' ? playerProfile.chips : 0
        };
    });
}

function emitPlayerState() {
    io.emit('updatePlayers', connectedPlayerIDs);
    io.emit('seatAssignmentsUpdate', getSeatStates());
    io.emit('hostUpdate', getHostId());
}

function emitActiveHandsState() {
    io.emit('activeHandsUpdate', Array.from(playerHands.keys()));
}

function getAdvanceButtonLabel() {
    if (!roundInProgress) return 'Start Round';
    if (currentStreet === 'river') return 'Start New Round';
    return 'Advance Round';
}

function emitRoundState() {
    io.emit('roundStateUpdate', {
        roundInProgress,
        street: currentStreet,
        communityCards,
        actionLabel: getAdvanceButtonLabel()
    });
}

function dealHandFromDeck(deck) {
    if (deck.length < 2) return null;
    const card1 = deck.pop();
    const card2 = deck.pop();
    return [card1, card2];
}

function dealCommunityCards(amount) {
    if (currentRoundDeck.length < amount) return false;
    for (let i = 0; i < amount; i++) {
        const card = currentRoundDeck.pop();
        if (!card) return false;
        communityCards.push(card);
    }
    return true;
}

function startRound() {
    currentRoundDeck = getNewDeck();
    shuffleDeck(currentRoundDeck);
    playerHands.clear();
    roundInProgress = true;
    currentStreet = 'preflop';
    communityCards = [];

    const playersInSeatOrder = getPlayersInSeatOrder();

    if (playersInSeatOrder.length * 2 > currentRoundDeck.length) {
        console.log('Not enough cards in the deck for all players.');
        roundInProgress = false;
        currentStreet = 'idle';
        emitActiveHandsState();
        emitRoundState();
        return;
    }

    if (currentGameId) {
        db.run('INSERT INTO round (game_id, timestamp) VALUES (?, ?)', [currentGameId, Date.now()], function(err) {
            if (err) console.error("Failed to insert round:", err.message);
            else {
                currentRoundId = this.lastID;

                for (let playerId of playersInSeatOrder) {
                    const hand = dealHandFromDeck(currentRoundDeck);
                    if (!hand) {
                        roundInProgress = false;
                        break;
                    }

                    playerHands.set(playerId, hand);
                    io.to(playerId).emit('receiveCards', hand);

                    const profile = playerProfiles.get(playerId);
                    if (profile && profile.dbUserId) {
                        const handString = hand.map(c => c.rank + c.suit).join(',');
                        db.run('INSERT INTO round_hand (round_id, user_id, hand_type) VALUES (?, ?, ?)', 
                            [currentRoundId, profile.dbUserId, handString]);
                    }
                }
                emitActiveHandsState();
                emitRoundState();
            }
        });
    }
}

function advanceRound() {
    if (!roundInProgress) {
        startRound();
        return;
    }

    if (currentStreet === 'preflop') {
        if (dealCommunityCards(3)) currentStreet = 'flop';
    } else if (currentStreet === 'flop') {
        if (dealCommunityCards(1)) currentStreet = 'turn';
    } else if (currentStreet === 'turn') {
        if (dealCommunityCards(1)) currentStreet = 'river';
    } else if (currentStreet === 'river') {
        startRound();
        return;
    }

    if (currentRoundId && communityCards.length > 0) {
        const communityString = communityCards.map(c => c.rank + c.suit).join(',');
        db.run('UPDATE round SET community_cards = ? WHERE round_id = ?', [communityString, currentRoundId]);
    }

    emitRoundState();
}

io.on('connection', (socket) => {
    console.log('A player connected. ID:', socket.id);

    emitPlayerState();
    socket.emit('receiveCards', []);
    emitActiveHandsState();
    emitRoundState();

    socket.on('chooseSeat', (choiceData) => {
        const seatNumber = typeof choiceData === 'number' ? choiceData : choiceData?.seatNumber;
        const username = typeof choiceData?.username === 'string' ? choiceData.username.trim() : '';
        const password = typeof choiceData?.password === 'string' ? choiceData.password : '';
        const chips = Number(choiceData?.chips);

        if (playerSeats.has(socket.id)) return socket.emit('seatChoiceError', 'You already chose a seat.');
        if (!isValidSeatNumber(seatNumber)) return socket.emit('seatChoiceError', 'Invalid seat number. Choose a seat from 1 to 8.');
        if (seatAssignments[seatNumber - 1]) return socket.emit('seatChoiceError', `Seat ${seatNumber} is already occupied.`);
        if (!username) return socket.emit('seatChoiceError', 'Username is required.');
        if (!password) return socket.emit('seatChoiceError', 'Password is required.');
        if (!Number.isFinite(chips) || chips < 0) return socket.emit('seatChoiceError', 'Chips must be a number of 0 or more.');

        db.get('SELECT user_id, username, password_hash FROM user WHERE username = ? LIMIT 1', [username], (err, row) => {
            if (err) return socket.emit('seatChoiceError', 'Database error.');

            if (!row) {
                return socket.emit('seatChoiceError', 'Invalid username or password.');
            }

            const providedPassword = normalizePasswordValue(password);
            const storedPassword = normalizePasswordValue(row.password_hash);

            if (!providedPassword || providedPassword !== storedPassword) {
                return socket.emit('seatChoiceError', 'Invalid username or password.');
            }

            const alreadySeated = Array.from(playerProfiles.values()).some((profile) => profile?.dbUserId === row.user_id);
            if (alreadySeated) {
                return socket.emit('seatChoiceError', 'This user is already seated.');
            }

            db.run('INSERT OR IGNORE INTO user_game (user_id, game_id, buy_ins) VALUES (?, ?, ?)', [row.user_id, currentGameId, chips]);

            seatAssignments[seatNumber - 1] = socket.id;
            playerSeats.set(socket.id, seatNumber);
            playerProfiles.set(socket.id, { name: row.username, chips: Math.floor(chips), dbUserId: row.user_id });
            connectedPlayerIDs.push(socket.id);

            console.log(`Player ${socket.id} (DB ID: ${row.user_id}) sat in seat ${seatNumber}.`);
            socket.emit('seatChosenSuccess', { seatNumber, name: row.username, chips: Math.floor(chips) });
            emitPlayerState();
            emitActiveHandsState();
            emitRoundState();
        });
    });

    socket.on('advanceRoundRequest', () => {
        if (socket.id === getHostId()) advanceRound();
    });

    socket.on('startRoundRequest', () => {
        if (socket.id === getHostId()) advanceRound();
    });

    socket.on('disconnect', () => {
        console.log('Player left the table:', socket.id);
        clearPlayerSeat(socket.id);
        connectedPlayerIDs = connectedPlayerIDs.filter(id => id !== socket.id);
        playerHands.delete(socket.id);

        emitPlayerState();
        emitActiveHandsState();
        emitRoundState();
    });
});

server.listen(3000, () => {
    console.log("Poker Server running on http://localhost:3000");
});