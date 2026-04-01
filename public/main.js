const socket = io("http://localhost:3000");
const startRoundBtn = document.getElementById('startRoundBtn');
const toggleCardStyleBtn = document.getElementById('toggleCardStyleBtn');
const communityCardsElement = document.getElementById('communityCards');

const suitColors = {
    '♥': '#d22',
    '♠': '#2e2e2e',
    '♣': '#149039',
    '♦': '#1d4ccd'
};

let currentCards = [];
let useSuitBackgrounds = false;
let connectedPlayerIds = [];
let activeHandPlayerIds = [];
let currentCommunityCards = [];

function advanceRound() {
    socket.emit('advanceRoundRequest');
}

function updateToggleButtonText() {
    if (!toggleCardStyleBtn) {
        return;
    }

    toggleCardStyleBtn.textContent = useSuitBackgrounds
        ? 'Use Suit Text Colors'
        : 'Use Suit Backgrounds';
}

function applyCardVisualMode(cardElement, card) {
    if (!card) {
        cardElement.style.color = '';
        cardElement.style.backgroundColor = '';
        cardElement.style.borderColor = '';
        return;
    }

    const suitColor = suitColors[card.suit] || '#111';

    if (useSuitBackgrounds) {
        cardElement.style.backgroundColor = suitColor;
        cardElement.style.borderColor = suitColor;
        cardElement.style.color = '#fff';
    } else {
        cardElement.style.backgroundColor = '#fff';
        cardElement.style.borderColor = '#d3d3d3';
        cardElement.style.color = suitColor;
    }
}

function displayCards(cards) {
    const cardElement1 = document.querySelector('.playerCard1');
    const cardElement2 = document.querySelector('.playerCard2');

    if (!cardElement1 || !cardElement2) {
        console.error('Card elements not found in DOM.');
        return;
    }

    function renderCard(cardElement, card, rankClass, suitClass) {
        cardElement.replaceChildren();
        applyCardVisualMode(cardElement, card);

        if (!card) {
            return;
        }

        const rankDiv = document.createElement('div');
        rankDiv.className = rankClass;
        rankDiv.textContent = card.rank;

        const suitDiv = document.createElement('div');
        suitDiv.className = suitClass;
        suitDiv.textContent = card.suit;

        cardElement.appendChild(rankDiv);
        cardElement.appendChild(suitDiv);
    }

    renderCard(cardElement1, cards[0], 'playerCard1Rank', 'playerCard1Suit');
    renderCard(cardElement2, cards[1], 'playerCard2Rank', 'playerCard2Suit');
}

function displayCommunityCards(cards) {
    if (!communityCardsElement) {
        return;
    }

    communityCardsElement.replaceChildren();

    if (!Array.isArray(cards) || cards.length === 0) {
        communityCardsElement.style.display = 'none';
        return;
    }

    cards.forEach((card) => {
        const cardElement = document.createElement('div');
        cardElement.className = 'card community-card';
        applyCardVisualMode(cardElement, card);

        const rankDiv = document.createElement('div');
        rankDiv.className = 'communityCardRank';
        rankDiv.textContent = card.rank;

        const suitDiv = document.createElement('div');
        suitDiv.className = 'communityCardSuit';
        suitDiv.textContent = card.suit;

        cardElement.appendChild(rankDiv);
        cardElement.appendChild(suitDiv);
        communityCardsElement.appendChild(cardElement);
    });

    communityCardsElement.style.display = 'flex';
}

function playerHasActiveHand(playerId) {
    return activeHandPlayerIds.includes(playerId);
}

function updateSeatCardVisibility() {
    const ownCardsContainer = document.querySelector('.seat.you .cards');
    const hasOwnHand = playerHasActiveHand(socket.id) && currentCards.length === 2;
    if (ownCardsContainer) {
        ownCardsContainer.style.display = hasOwnHand ? 'flex' : 'none';
    }

    const opponentIds = connectedPlayerIds.filter(id => id !== socket.id);
    const opponentSeats = document.querySelectorAll('.seat:not(.you)');

    opponentSeats.forEach((seat, index) => {
        const seatLabel = seat.querySelector('p');
        const seatCards = seat.querySelector('.cards');
        const opponentId = opponentIds[index];

        if (opponentId) {
            if (seatLabel) {
                seatLabel.textContent = "ID: " + opponentId.substring(0, 5);
            }

            if (seatCards) {
                seatCards.style.display = playerHasActiveHand(opponentId) ? 'flex' : 'none';
            }
        } else {
            if (seatLabel) {
                // seatLabel.textContent = "Waiting...";
            }

            if (seatCards) {
                seatCards.style.display = 'none';
            }
        }
    });
}

startRoundBtn.addEventListener('click', advanceRound);

if (toggleCardStyleBtn) {
    toggleCardStyleBtn.addEventListener('click', () => {
        useSuitBackgrounds = !useSuitBackgrounds;
        updateToggleButtonText();
        displayCards(currentCards);
        displayCommunityCards(currentCommunityCards);
    });
}

updateToggleButtonText();

socket.on('receiveCards', (cards) => {
    console.log("The server dealt me:", cards);
    currentCards = Array.isArray(cards) ? cards : [];
    displayCards(currentCards);
    updateSeatCardVisibility();
});

socket.on('playerCountUpdate', (count) => {
    console.log(`There are now ${count} players at the table.`);
});

socket.on('updatePlayers', (allPlayerIds) => {
    connectedPlayerIds = Array.isArray(allPlayerIds) ? allPlayerIds : [];
    updateSeatCardVisibility();
});

socket.on('activeHandsUpdate', (playerIdsWithHands) => {
    activeHandPlayerIds = Array.isArray(playerIdsWithHands) ? playerIdsWithHands : [];
    updateSeatCardVisibility();
});

socket.on('hostUpdate', (hostId) => {
    const isHost = hostId === socket.id;
    startRoundBtn.style.display = isHost ? 'inline-flex' : 'none';
});

socket.on('roundStateUpdate', (roundState) => {
    if (!roundState || typeof roundState !== 'object') {
        return;
    }

    currentCommunityCards = Array.isArray(roundState.communityCards)
        ? roundState.communityCards
        : [];

    displayCommunityCards(currentCommunityCards);

    if (typeof roundState.actionLabel === 'string' && startRoundBtn) {
        startRoundBtn.textContent = roundState.actionLabel;
    }
});

updateSeatCardVisibility();
displayCommunityCards(currentCommunityCards);