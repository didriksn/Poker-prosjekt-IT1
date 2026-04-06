const io = require('socket.io')(3000, {
    cors: { origin: "*" } 
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

function shuffleDeck(deck) {
    // Fisher-Yates shuffle for an unbiased in-place shuffle.
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

function getPlayersInSeatOrder() {
    return seatAssignments.filter(playerId => Boolean(playerId));
}

function clearPlayerSeat(playerId) {
    const seatNumber = playerSeats.get(playerId);
    if (!seatNumber) {
        return;
    }

    seatAssignments[seatNumber - 1] = null;
    playerSeats.delete(playerId);
    playerProfiles.delete(playerId);
}

function getSeatStates() {
    return seatAssignments.map((playerId) => {
        if (!playerId) {
            return null;
        }

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
    if (!roundInProgress) {
        return 'Start Round';
    }

    if (currentStreet === 'river') {
        return 'Start New Round';
    }

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
    if (deck.length < 2) {
        return null;
    }

    const card1 = deck.pop();
    const card2 = deck.pop();
    return [card1, card2];
}

function dealCommunityCards(amount) {
    if (currentRoundDeck.length < amount) {
        return false;
    }

    for (let i = 0; i < amount; i++) {
        const card = currentRoundDeck.pop();
        if (!card) {
            return false;
        }

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
        communityCards = [];
        emitActiveHandsState();
        emitRoundState();
        return;
    }

    for (let playerId of playersInSeatOrder) {
        const hand = dealHandFromDeck(currentRoundDeck);
        if (!hand) {
            roundInProgress = false;
            break;
        }

        playerHands.set(playerId, hand);
        io.to(playerId).emit('receiveCards', hand);
    }

    emitActiveHandsState();
    emitRoundState();
}

function advanceRound() {
    if (!roundInProgress) {
        startRound();
        return;
    }

    if (currentStreet === 'preflop') {
        if (dealCommunityCards(3)) {
            currentStreet = 'flop';
        }
    } else if (currentStreet === 'flop') {
        if (dealCommunityCards(1)) {
            currentStreet = 'turn';
        }
    } else if (currentStreet === 'turn') {
        if (dealCommunityCards(1)) {
            currentStreet = 'river';
        }
    } else if (currentStreet === 'river') {
        startRound();
        return;
    }

    emitRoundState();
}


io.on('connection', (socket) => {
    console.log('A player connected. ID:', socket.id);

    emitPlayerState();

    if (roundInProgress) {
        // Players joining mid-round should wait for the next round.
        socket.emit('receiveCards', []);
    } else {
        socket.emit('receiveCards', []);
    }

    emitActiveHandsState();
    emitRoundState();

    socket.on('chooseSeat', (choiceData) => {
        const seatNumber = typeof choiceData === 'number'
            ? choiceData
            : choiceData?.seatNumber;
        const name = typeof choiceData?.name === 'string'
            ? choiceData.name.trim()
            : '';
        const chips = Number(choiceData?.chips);

        if (playerSeats.has(socket.id)) {
            socket.emit('seatChoiceError', 'You already chose a seat.');
            return;
        }

        if (!isValidSeatNumber(seatNumber)) {
            socket.emit('seatChoiceError', 'Invalid seat number. Choose a seat from 1 to 8.');
            return;
        }

        if (seatAssignments[seatNumber - 1]) {
            socket.emit('seatChoiceError', `Seat ${seatNumber} is already occupied.`);
            return;
        }

        if (name.length < 3) {
            socket.emit('seatChoiceError', 'Name must be at least 3 characters long.');
            return;
        }

        if (!Number.isFinite(chips) || chips < 0) {
            socket.emit('seatChoiceError', 'Chips must be a number of 0 or more.');
            return;
        }

        seatAssignments[seatNumber - 1] = socket.id;
        playerSeats.set(socket.id, seatNumber);
        playerProfiles.set(socket.id, {
            name,
            chips: Math.floor(chips)
        });
        connectedPlayerIDs.push(socket.id);

        console.log(`Player ${socket.id} sat in seat ${seatNumber}.`);
        socket.emit('seatChosenSuccess', { seatNumber, name, chips: Math.floor(chips) });
        emitPlayerState();
        emitActiveHandsState();
        emitRoundState();
    });

    socket.on('advanceRoundRequest', () => {
        if (socket.id !== getHostId()) {
            return;
        }

        advanceRound();
    });

    // Backwards compatible event name.
    socket.on('startRoundRequest', () => {
        if (socket.id !== getHostId()) {
            return;
        }

        advanceRound();
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

console.log("Poker Server running on port 3000...");