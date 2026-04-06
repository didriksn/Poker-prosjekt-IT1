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
            continue;
        }

        if (!hasActiveHand) {
            seatCards.style.display = 'none';
            continue;
        }

        seatCards.style.display = 'flex';

        if (isCurrentPlayer && currentCards.length === 2) {
            renderFaceCards(seatCards, currentCards);
        } else {
            renderBackCards(seatCards);
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

    const nameValue = (seatPlayerNameInput?.value || '').trim();
    const chipsValue = Number(seatPlayerChipsInput?.value);

    if (nameValue.length < 3) {
        showSeatChoiceError('Name must be at least 3 characters.');
        return;
    }

    if (!Number.isFinite(chipsValue) || chipsValue < 0) {
        showSeatChoiceError('Chips must be 0 or greater.');
        return;
    }

    const selectedSeat = pendingSeatNumber;
    setSeatPickerStatus(`Trying to take seat ${selectedSeat}...`);
    closeSeatChoiceModal();

    socket.emit('chooseSeat', {
        seatNumber: selectedSeat,
        name: nameValue,
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
    updateSeatCardVisibility();
});

socket.on('activeHandsUpdate', (playerIdsWithHands) => {
    activeHandPlayerIds = Array.isArray(playerIdsWithHands) ? playerIdsWithHands : [];
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
});

socket.on('seatChoiceError', (message) => {
    const fallbackMessage = 'Seat selection failed. Please try another seat.';
    setSeatPickerStatus(typeof message === 'string' ? message : fallbackMessage);
    updateSeatPickerButtons();
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

    if (typeof roundState.actionLabel === 'string' && startRoundBtn) {
        startRoundBtn.textContent = roundState.actionLabel;
    }
});

updateSeatCardVisibility();
displayCommunityCards(currentCommunityCards);
socket.connect();