const socket = io("http://localhost:3000", { autoConnect: false });
const startRoundBtn = document.getElementById('startRoundBtn');
const toggleCardStyleBtn = document.getElementById('toggleCardStyleBtn');
const communityCardsElement = document.getElementById('communityCards');
const seatPickerSection = document.querySelector('.seat-picker');
const seatPickerStatusElement = document.getElementById('seatPickerStatus');
const seatPickerButtonsElement = document.getElementById('seatPickerButtons');

const seatChoiceModal = document.getElementById('seatChoiceModal');
const seatChoiceTitle = document.getElementById('seatChoiceTitle');
const seatPlayerNameInput = document.getElementById('seatPlayerName');
const seatPlayerPasswordInput = document.getElementById('seatPlayerPassword');
const seatPlayerChipsInput = document.getElementById('seatPlayerChips');
const seatChoiceErrorElement = document.getElementById('seatChoiceError');
const seatChoiceCancelBtn = document.getElementById('seatChoiceCancel');
const seatChoiceConfirmBtn = document.getElementById('seatChoiceConfirm');

const suitColors = {
    '♥': '#d22',
    '♠': '#2e2e2e',
    '♣': '#149039',
    '♦': '#1d4ccd'
};

const TOTAL_SEATS = 8;
let currentCards = [];
let useSuitBackgrounds = false;
let activeHandPlayerIds = [];
let currentCommunityCards = [];
const handByPlayerId = new Map();
let seatStates = Array(TOTAL_SEATS).fill(null);
let mySeatNumber = null;
let currentHostId = null;
let pendingSeatNumber = null;

function setSeatPickerStatus(message) {
    if (!seatPickerStatusElement) {
        return;
    }

    seatPickerStatusElement.textContent = message;
}

function getSlotElement(slotIndex) {
    return document.querySelector(`.seat[data-slot="${slotIndex}"]`);
}

function getAnchorSeatNumber() {
    return mySeatNumber ?? 1;
}

function seatNumberToSlotIndex(seatNumber) {
    const anchorIndex = getAnchorSeatNumber() - 1;
    const seatIndex = seatNumber - 1;
    return (seatIndex - anchorIndex + TOTAL_SEATS) % TOTAL_SEATS;
}

function openSeatChoiceModal(seatNumber) {
    pendingSeatNumber = seatNumber;

    if (seatChoiceTitle) {
        seatChoiceTitle.textContent = `Join Seat ${seatNumber}`;
    }

    if (seatChoiceErrorElement) {
        seatChoiceErrorElement.textContent = '';
    }

    if (seatChoiceModal) {
        seatChoiceModal.classList.add('open');
        seatChoiceModal.setAttribute('aria-hidden', 'false');
    }

    if (seatPlayerNameInput) {
        seatPlayerNameInput.focus();
        seatPlayerNameInput.select();
    }
}

function closeSeatChoiceModal() {
    pendingSeatNumber = null;

    if (seatChoiceErrorElement) {
        seatChoiceErrorElement.textContent = '';
    }

    if (seatChoiceModal) {
        seatChoiceModal.classList.remove('open');
        seatChoiceModal.setAttribute('aria-hidden', 'true');
    }
}

function showSeatChoiceError(message) {
    if (!seatChoiceErrorElement) {
        return;
    }

    seatChoiceErrorElement.textContent = message;
}

function updateToggleButtonText() {
    if (!toggleCardStyleBtn) {
        return;
    }

    toggleCardStyleBtn.textContent = useSuitBackgrounds
        ? 'Use Suit Text Colors'
        : 'Use Suit Backgrounds';
}

function updateSeatPickerVisibility() {
    if (!seatPickerSection) {
        return;
    }

    seatPickerSection.style.display = mySeatNumber === null ? 'block' : 'none';
}

function updateHostControls() {
    if (!startRoundBtn) {
        return;
    }

    const isHost = currentHostId === socket.id;
    const isSeated = mySeatNumber !== null;
    startRoundBtn.style.display = isHost && isSeated ? 'inline-flex' : 'none';
}

function updateSeatPickerButtons() {
    if (!seatPickerButtonsElement) {
        return;
    }

    const buttons = seatPickerButtonsElement.querySelectorAll('button');
    buttons.forEach((button) => {
        const seatNumber = Number(button.dataset.seat);
        const seatState = seatStates[seatNumber - 1] || null;
        const isMine = seatState?.playerId === socket.id;
        const isTakenBySomeoneElse = Boolean(seatState) && !isMine;

        button.disabled = isTakenBySomeoneElse || (mySeatNumber !== null && !isMine);
        button.classList.toggle('selected', isMine);

        if (isMine) {
            button.textContent = `Seat ${seatNumber} (You)`;
        } else if (isTakenBySomeoneElse) {
            button.textContent = `Seat ${seatNumber} (Taken)`;
        } else {
            button.textContent = `Seat ${seatNumber}`;
        }
    });
}

function buildSeatPickerButtons() {
    if (!seatPickerButtonsElement) {
        return;
    }

    seatPickerButtonsElement.replaceChildren();

    for (let seatNumber = 1; seatNumber <= TOTAL_SEATS; seatNumber++) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'seat-picker-btn';
        button.dataset.seat = String(seatNumber);
        button.textContent = `Seat ${seatNumber}`;

        button.addEventListener('click', () => {
            if (mySeatNumber !== null) {
                return;
            }

            const seatState = seatStates[seatNumber - 1] || null;
            if (seatState) {
                return;
            }

            openSeatChoiceModal(seatNumber);
        });

        seatPickerButtonsElement.appendChild(button);
    }

    updateSeatPickerButtons();
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

function renderBackCards(cardsContainer) {
    cardsContainer.replaceChildren();

    const backCardA = document.createElement('div');
    backCardA.className = 'card back';

    const backCardB = document.createElement('div');
    backCardB.className = 'card back';

    cardsContainer.appendChild(backCardA);
    cardsContainer.appendChild(backCardB);
}

function renderFaceCards(cardsContainer, cards) {
    cardsContainer.replaceChildren();

    cards.forEach((card) => {
        const cardElement = document.createElement('div');
        cardElement.className = 'card';
        applyCardVisualMode(cardElement, card);

        const rankDiv = document.createElement('div');
        rankDiv.className = 'playerCardRank';
        rankDiv.textContent = card.rank;

        const suitDiv = document.createElement('div');
        suitDiv.className = 'playerCardSuit';
        suitDiv.textContent = card.suit;

        cardElement.appendChild(rankDiv);
        cardElement.appendChild(suitDiv);
        cardsContainer.appendChild(cardElement);
    });
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

function getCardRankValue(rank) {
    const rankMap = {
        '2': 2,
        '3': 3,
        '4': 4,
        '5': 5,
        '6': 6,
        '7': 7,
        '8': 8,
        '9': 9,
        '10': 10,
        J: 11,
        Q: 12,
        K: 13,
        A: 14
    };

    return rankMap[String(rank)] || null;
}

function findStraightHigh(rankValues) {
    const uniqueAsc = [...new Set(rankValues)].sort((a, b) => a - b);
    if (uniqueAsc.includes(14)) {
        uniqueAsc.unshift(1);
    }

    let bestHigh = 0;
    let runLength = 1;

    for (let i = 1; i < uniqueAsc.length; i++) {
        if (uniqueAsc[i] === uniqueAsc[i - 1] + 1) {
            runLength += 1;
            if (runLength >= 5) {
                bestHigh = Math.max(bestHigh, uniqueAsc[i]);
            }
        } else {
            runLength = 1;
        }
    }

    return bestHigh;
}

function getBestHandName(cards) {
    const validCards = (Array.isArray(cards) ? cards : []).filter((card) => {
        if (!card || typeof card !== 'object') {
            return false;
        }

        const value = getCardRankValue(card.rank);
        return Number.isInteger(value) && typeof card.suit === 'string';
    });

    if (validCards.length === 0) {
        return '';
    }

    const rankCounts = new Map();
    const cardsBySuit = new Map();
    const allRankValues = [];

    validCards.forEach((card) => {
        const value = getCardRankValue(card.rank);
        allRankValues.push(value);

        rankCounts.set(value, (rankCounts.get(value) || 0) + 1);

        if (!cardsBySuit.has(card.suit)) {
            cardsBySuit.set(card.suit, []);
        }

        cardsBySuit.get(card.suit).push(value);
    });

    let straightFlushHigh = 0;
    let hasRoyalFlush = false;

    cardsBySuit.forEach((values) => {
        if (values.length < 5) {
            return;
        }

        const suitUnique = [...new Set(values)];
        const suitStraightHigh = findStraightHigh(suitUnique);
        if (suitStraightHigh > straightFlushHigh) {
            straightFlushHigh = suitStraightHigh;
        }

        if (suitStraightHigh === 14) {
            const royalRanks = [10, 11, 12, 13, 14];
            const hasAllRoyalRanks = royalRanks.every((rankValue) => suitUnique.includes(rankValue));
            if (hasAllRoyalRanks) {
                hasRoyalFlush = true;
            }
        }
    });

    if (hasRoyalFlush) {
        return 'Royal Flush';
    }

    if (straightFlushHigh >= 5) {
        return 'Straight Flush';
    }

    const countEntries = [...rankCounts.entries()];
    const fourOfKind = countEntries.some(([, count]) => count === 4);
    if (fourOfKind) {
        return 'Four of a Kind';
    }

    const trips = countEntries
        .filter(([, count]) => count >= 3)
        .map(([value]) => value)
        .sort((a, b) => b - a);

    const pairs = countEntries
        .filter(([, count]) => count >= 2)
        .map(([value]) => value)
        .sort((a, b) => b - a);

    if (trips.length >= 1) {
        const bestTrip = trips[0];
        const remainingPairCandidates = pairs.filter((value) => value !== bestTrip);

        if (remainingPairCandidates.length >= 1 || trips.length >= 2) {
            return 'Full House';
        }
    }

    const hasFlush = [...cardsBySuit.values()].some((values) => values.length >= 5);
    if (hasFlush) return 'Flush';

    const straightHigh = findStraightHigh(allRankValues);
    if (straightHigh >= 5) return 'Straight';
    
    if (trips.length >= 1) return 'Three of a Kind';
    if (pairs.length >= 2) return 'Two Pair';
    if (pairs.length === 1) return 'Pair';
    
    return 'High Card';
}

function updateCurrentPlayerHandInfo() {
    if (!socket.id) {
        return;
    }

    handByPlayerId.delete(socket.id);

    if (!playerHasActiveHand(socket.id) || currentCards.length === 0) {
        return;
    }

    const combinedCards = [...currentCards, ...currentCommunityCards];
    const handName = getBestHandName(combinedCards);

    if (handName) {
        handByPlayerId.set(socket.id, handName);
    }
}

function ensureSeatHandLabelElement(seatElement) {
    let handLabel = seatElement.querySelector('.seat-hand-label');

    if (!handLabel) {
        handLabel = document.createElement('p');
        handLabel.className = 'seat-hand-label';
        seatElement.appendChild(handLabel);
    }

    return handLabel;
}

function applySeatLabelColorClasses(labelElement, isEmptySeat) {
    if (!labelElement) {
        return;
    }

    labelElement.classList.remove('status-empty', 'status-taken');

    if (mySeatNumber !== null) {
        return;
    }

    labelElement.classList.add(isEmptySeat ? 'status-empty' : 'status-taken');
}

function updateSeatCardVisibility() {
    for (let seatNumber = 1; seatNumber <= TOTAL_SEATS; seatNumber++) {
        const slotIndex = seatNumberToSlotIndex(seatNumber);
        const seatElement = getSlotElement(slotIndex);
        if (!seatElement) {
            continue;
        }

        const seatLabel = seatElement.querySelector('p');
        const seatCards = seatElement.querySelector('.cards');
        const handLabel = ensureSeatHandLabelElement(seatElement);
        const seatState = seatStates[seatNumber - 1] || null;

        if (!seatState) {
            if (seatLabel) {
                if (mySeatNumber === null) {
                    seatLabel.textContent = `Seat ${seatNumber}: Empty`;
                    applySeatLabelColorClasses(seatLabel, true);
                } else {
                    seatLabel.textContent = '';
                    applySeatLabelColorClasses(seatLabel, true);
                }
            }

            if (seatCards) {
                seatCards.style.display = 'none';
            }

            handLabel.textContent = '';
            handLabel.style.display = 'none';

            seatElement.classList.remove('current-player');
            continue;
        }

        const isCurrentPlayer = seatState.playerId === socket.id;
        const hasActiveHand = playerHasActiveHand(seatState.playerId);

        if (seatLabel) {
            const playerName = seatState.name || seatState.playerId.substring(0, 5);
            seatLabel.textContent = isCurrentPlayer
                ? `${playerName} (You)`
                : playerName;
            applySeatLabelColorClasses(seatLabel, false);
        }

        seatElement.classList.toggle('current-player', isCurrentPlayer);

        if (!seatCards) {
            handLabel.textContent = '';
            handLabel.style.display = 'none';
            continue;
        }

        if (!hasActiveHand) {
            seatCards.style.display = 'none';
            handLabel.textContent = '';
            handLabel.style.display = 'none';
            continue;
        }

        seatCards.style.display = 'flex';

        if (isCurrentPlayer && currentCards.length === 2) {
            renderFaceCards(seatCards, currentCards);
        } else {
            renderBackCards(seatCards);
        }

        const handName = handByPlayerId.get(seatState.playerId);
        if (handName) {
            handLabel.textContent = handName;
            handLabel.style.display = 'block';
        } else {
            handLabel.textContent = '';
            handLabel.style.display = 'none';
        }
    }
}

function advanceRound() {
    socket.emit('advanceRoundRequest');
}

function submitSeatChoice() {
    if (pendingSeatNumber === null) {
        return;
    }

    const usernameValue = (seatPlayerNameInput?.value || '').trim();
    const passwordValue = (seatPlayerPasswordInput?.value || '').trim();
    const chipsValue = Number(seatPlayerChipsInput?.value);

    if (!usernameValue) {
        showSeatChoiceError('Username is required.');
        return;
    }

    if (!passwordValue) {
        showSeatChoiceError('Password is required.');
        return;
    }

    if (!Number.isFinite(chipsValue) || chipsValue < 0) {
        showSeatChoiceError('Chips must be 0 or greater.');
        return;
    }

    const selectedSeat = pendingSeatNumber;
    setSeatPickerStatus(`Trying to take seat ${selectedSeat}...`);

    socket.emit('chooseSeat', {
        seatNumber: selectedSeat,
        username: usernameValue,
        password: passwordValue,
        chips: Math.floor(chipsValue)
    });
}

if (startRoundBtn) {
    startRoundBtn.addEventListener('click', advanceRound);
}

if (toggleCardStyleBtn) {
    toggleCardStyleBtn.addEventListener('click', () => {
        useSuitBackgrounds = !useSuitBackgrounds;
        updateToggleButtonText();
        updateSeatCardVisibility();
        displayCommunityCards(currentCommunityCards);
    });
}

if (seatChoiceCancelBtn) {
    seatChoiceCancelBtn.addEventListener('click', closeSeatChoiceModal);
}

if (seatChoiceConfirmBtn) {
    seatChoiceConfirmBtn.addEventListener('click', submitSeatChoice);
}

buildSeatPickerButtons();
updateToggleButtonText();
updateSeatPickerVisibility();

socket.on('receiveCards', (cards) => {
    currentCards = Array.isArray(cards) ? cards : [];
    updateCurrentPlayerHandInfo();
    updateSeatCardVisibility();
});

socket.on('seatAssignmentsUpdate', (allSeatStates) => {
    if (Array.isArray(allSeatStates) && allSeatStates.length === TOTAL_SEATS) {
        seatStates = allSeatStates;
    }

    const mySeatIndex = seatStates.findIndex((seatState) => seatState?.playerId === socket.id);
    mySeatNumber = mySeatIndex >= 0 ? mySeatIndex + 1 : null;

    if (mySeatNumber !== null) {
        setSeatPickerStatus(`You are seated at seat ${mySeatNumber}.`);
        closeSeatChoiceModal();
    } else {
        setSeatPickerStatus('Choose a seat (1-8) to join the table.');
    }

    updateSeatPickerVisibility();
    updateSeatPickerButtons();
    updateHostControls();
    updateCurrentPlayerHandInfo();
    updateSeatCardVisibility();
});

socket.on('activeHandsUpdate', (playerIdsWithHands) => {
    activeHandPlayerIds = Array.isArray(playerIdsWithHands) ? playerIdsWithHands : [];
    updateCurrentPlayerHandInfo();
    updateSeatCardVisibility();
});

socket.on('hostUpdate', (hostId) => {
    currentHostId = hostId;
    updateHostControls();
});

socket.on('seatChosenSuccess', ({ seatNumber }) => {
    setSeatPickerStatus(`You are seated at seat ${seatNumber}.`);
    updateSeatPickerVisibility();
    updateSeatPickerButtons();
    closeSeatChoiceModal();
});

socket.on('seatChoiceError', (message) => {
    const fallbackMessage = 'Seat selection failed. Please try another seat.';
    setSeatPickerStatus(typeof message === 'string' ? message : fallbackMessage);
    updateSeatPickerButtons();
    if (seatChoiceModal) {
        seatChoiceModal.classList.add('open');
        seatChoiceModal.setAttribute('aria-hidden', 'false');
    }
});

socket.on('connect', () => {
    if (mySeatNumber === null) {
        setSeatPickerStatus('Choose a seat (1-8) to join the table.');
    }
});

socket.on('roundStateUpdate', (roundState) => {
    if (!roundState || typeof roundState !== 'object') {
        return;
    }

    currentCommunityCards = Array.isArray(roundState.communityCards)
        ? roundState.communityCards
        : [];

    displayCommunityCards(currentCommunityCards);
    updateCurrentPlayerHandInfo();
    updateSeatCardVisibility();

    if (typeof roundState.actionLabel === 'string' && startRoundBtn) {
        startRoundBtn.textContent = roundState.actionLabel;
    }
});

updateSeatCardVisibility();
displayCommunityCards(currentCommunityCards);
socket.connect();