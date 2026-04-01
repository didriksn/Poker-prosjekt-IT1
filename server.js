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

function getHostId() {
    return connectedPlayerIDs[0] ?? null;
}

function emitPlayerState() {
    io.emit('updatePlayers', connectedPlayerIDs);
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

    if (connectedPlayerIDs.length * 2 > currentRoundDeck.length) {
        console.log('Not enough cards in the deck for all players.');
        roundInProgress = false;
        currentStreet = 'idle';
        communityCards = [];
        emitActiveHandsState();
        emitRoundState();
        return;
    }

    for (let playerId of connectedPlayerIDs) {
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
    console.log('A player sat at the table! ID:', socket.id);
    
    connectedPlayerIDs.push(socket.id);

    emitPlayerState();

    if (roundInProgress) {
        // Players joining mid-round should wait for the next round.
        socket.emit('receiveCards', []);
    } else {
        socket.emit('receiveCards', []);
    }

    emitActiveHandsState();
    emitRoundState();

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
        
        connectedPlayerIDs = connectedPlayerIDs.filter(id => id !== socket.id);
        playerHands.delete(socket.id);

        emitPlayerState();
        emitActiveHandsState();
        emitRoundState();
    });
});

console.log("Poker Server running on port 3000...");