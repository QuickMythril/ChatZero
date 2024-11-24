// Toggle logs for testing
const enableLogging = false;

// Variables to store user data and state
let userAccount = null;
let userAddress = null;
let userPublicKey = null;
let userName = null;
let groupMessages = [];
let isLoggedIn = false;
// Cache for address & avatar mapping
let addressNameMap = {};
let avatarCache = {};

// Initialize the application
async function init() {
    document.getElementById('login-button').addEventListener('click', login);
    document.getElementById('send-button').addEventListener('click', sendMessage);
    document.getElementById('message-input').addEventListener('keydown', function(event) {
        if (event.key === 'Enter') {
            event.preventDefault(); // Prevents adding a newline
            sendMessage();
        }
    });
    document.getElementById('toggle-user-list-button').addEventListener('click', function() {
        const sidebar = document.getElementById('sidebar-right');
        if (sidebar.style.display === 'none' || sidebar.style.display === '') {
            sidebar.style.display = 'block';
        } else {
            sidebar.style.display = 'none';
        }
        // Mobile compatibility
        if (sidebar.classList.contains('show')) {
            sidebar.classList.remove('show');
        } else {
            sidebar.classList.add('show');
        }
    });
    // Load messages and users
    await loadMessagesAndUsers();
    // Periodically refresh messages and users
    setInterval(loadMessagesAndUsers, 15000); // Refresh every 15 seconds
}

// Base58 encoding and decoding functions
(function () {
    const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    const ALPHABET_MAP = {};
    for (let i = 0; i < ALPHABET.length; i++) {
        ALPHABET_MAP[ALPHABET.charAt(i)] = i;
    }
    const BASE = 58;
    function base58Encode(buffer) {
        if (buffer.length === 0) return '';
        let digits = [0];
        for (let i = 0; i < buffer.length; i++) {
            let carry = buffer[i];
            for (let j = 0; j < digits.length; j++) {
                const x = digits[j] * 256 + carry;
                digits[j] = x % BASE;
                carry = Math.floor(x / BASE);
            }
            while (carry > 0) {
                digits.push(carry % BASE);
                carry = Math.floor(carry / BASE);
            }
        }
        // Deal with leading zeros
        for (let i = 0; i < buffer.length && buffer[i] === 0; i++) {
            digits.push(0);
        }
        return digits.reverse().map(d => ALPHABET[d]).join('');
    }
    function base58Decode(string) {
        if (string.length === 0) return new Uint8Array(0);
        let bytes = [0];
        for (let i = 0; i < string.length; i++) {
            const c = string[i];
            const value = ALPHABET_MAP[c];
            if (value === undefined) {
                throw new Error('Invalid base58 character');
            }
            let carry = value;
            for (let j = 0; j < bytes.length; j++) {
                const x = bytes[j] * BASE + carry;
                bytes[j] = x & 0xff;
                carry = x >> 8;
            }
            while (carry > 0) {
                bytes.push(carry & 0xff);
                carry >>= 8;
            }
        }
        // Deal with leading zeros
        for (let i = 0; i < string.length && string[i] === ALPHABET[0]; i++) {
            bytes.push(0);
        }
        return new Uint8Array(bytes.reverse());
    }
    // Expose the functions globally
    window.base58Encode = base58Encode;
    window.base58Decode = base58Decode;
})();

// Combined function to load messages and active users
async function loadMessagesAndUsers() {
    try {
        // Display logging message: Starting search
        displayLogMessage('Starting to search for messages...');
        // Fetch messages for groupId 0
        const messages = await qortalRequest({
            action: 'SEARCH_CHAT_MESSAGES',
            txGroupId: 0
        });
        // Display logging message: Number of messages found
        displayLogMessage(`Found ${messages.length} messages.`);
        groupMessages = messages;
        // Build message map to handle edits
        let messageMap = {};
        // Counter for processed messages
        let processedMessages = 0;
        for (let msg of groupMessages) {
            processedMessages++;
            // Display logging message: Message processing progress
            displayLogMessage(`Processing message ${processedMessages} of ${groupMessages.length}...`);
            // Determine the message ID (original or edited)
            let messageId = msg.chatReference || msg.signature;
            let existingMessage = messageMap[messageId];
            // Update the message map with the latest message based on timestamp
            if (!existingMessage || msg.timestamp > existingMessage.timestamp) {
                messageMap[messageId] = msg;
            }
        }
        // Get the messages to display and sort them by timestamp
        let messagesToDisplay = Object.values(messageMap);
        messagesToDisplay.sort((a, b) => a.timestamp - b.timestamp);
        // Display messages
        const chatMessages = document.getElementById('chat-messages');
        chatMessages.innerHTML = '';
        // Set to collect active users
        const activeUsers = new Set();
        processedMessages = 0;
        for (let msg of messagesToDisplay) {
            const messageElement = document.createElement('div');
            messageElement.classList.add('message-item');
            const senderName = await getNameForAddress(msg.sender);
            // Add sender to active users
            activeUsers.add(msg.sender);
            // Highlight messages from the logged-in user
            if (isLoggedIn && msg.sender === userAddress) {
                messageElement.classList.add('highlighted-message');
            }
            // Create avatar image
            const avatarImg = document.createElement('img');
            const name = addressNameMap[msg.sender] || msg.sender;
            avatarImg.src = avatarCache[name] || 'default-avatar.png';
            // Create message content
            const messageContent = document.createElement('div');
            messageContent.classList.add('message-content');
            let messageText = '';
            if (msg.isEncrypted) {
                messageText = '[Encrypted Message]';
            } else {
                try {
                    const decodedBytes = base58Decode(msg.data);
                    const jsonString = new TextDecoder().decode(decodedBytes);
                    const messageObject = JSON.parse(jsonString);
                    messageText = extractTextFromMessage(messageObject.messageText);
                } catch (e) {
                    messageText = '[Unable to decode message]';
                }
            }
            const formattedTimestamp = formatTimestamp(msg.timestamp);
            messageContent.innerHTML = `<strong>${senderName}</strong> <span style="color: gray; font-size: 0.8em;">${formattedTimestamp}</span><br>${messageText}`;
            // Append avatar and content to message element
            messageElement.appendChild(avatarImg);
            messageElement.appendChild(messageContent);
            chatMessages.appendChild(messageElement);
        }
        // Scroll to the bottom
        chatMessages.scrollTop = chatMessages.scrollHeight;
        // Display logging message: Starting user processing
        displayUserLogMessage(`Found ${activeUsers.size} active users.`);
        displayUserLogMessage('Starting to process active users...');
        // Display active users
        const userList = document.getElementById('user-list');
        userList.innerHTML = '';
        // Counter for processed users
        let processedUsers = 0;
        for (let user of activeUsers) {
            const userItem = document.createElement('li');
            userItem.classList.add('user-item');
            // Highlight the logged-in user
            if (isLoggedIn && user === userAddress) {
                userItem.classList.add('highlighted-user');
            }
            const avatarImg = document.createElement('img');
            const userName = await getNameForAddress(user);
            avatarImg.src = avatarCache[userName] || 'default-avatar.png';
            const userNameSpan = document.createElement('span');
            userNameSpan.textContent = userName;
            userItem.appendChild(avatarImg);
            userItem.appendChild(userNameSpan);
            userList.appendChild(userItem);
        }
        // Final logging messages
        displayLogMessage('Finished processing messages.');
        displayUserLogMessage('Finished processing users.');
    } catch (error) {
        console.error('Error loading messages and users:', error);
        displayLogMessage(`Error loading messages and users: ${error}`);
    }
}

// Function to display log messages in the chat window
function displayLogMessage(message) {
    if (enableLogging) {
        const chatMessages = document.getElementById('chat-messages');
        const logElement = document.createElement('div');
        logElement.textContent = `[Log]: ${message}`;
        logElement.style.color = 'gray';
        logElement.style.fontStyle = 'italic';
        chatMessages.appendChild(logElement);
    }
}

// Function to display log messages in the user list
function displayUserLogMessage(message) {
    if (enableLogging) {
        const userList = document.getElementById('user-list');
        const logElement = document.createElement('li');
        logElement.textContent = `[Log]: ${message}`;
        logElement.style.color = 'gray';
        logElement.style.fontStyle = 'italic';
        userList.appendChild(logElement);
    }
}

// Handle user login
async function login() {
    if (isLoggedIn) {
        // Logout
        userAccount = null;
        userAddress = null;
        userPublicKey = null;
        userName = null;
        isLoggedIn = false;
        // Update login button text
        document.getElementById('login-button').textContent = 'Login';
        displayLogMessage('Logged out.');
    } else {
        // Login
        try {
            const account = await qortalRequest({
                action: "GET_USER_ACCOUNT"
            });
            userAccount = account;
            userAddress = account.address;
            userPublicKey = account.publicKey;
            isLoggedIn = true;
            // Get user name
            userName = await getNameForAddress(userAddress);
            // Update login button text
            document.getElementById('login-button').textContent = 'Logout';
            // Display logging message: Login successful
            displayLogMessage(`Logged in as ${userName}.`);
        } catch (error) {
            console.error('Error during login:', error);
            displayLogMessage(`Error during login: ${error}`);
        }
    }
}

// Function to get the name for an address
async function getNameForAddress(address) {
    if (addressNameMap[address]) {
        return addressNameMap[address];
    } else {
        try {
            const names = await qortalRequest({
                action: 'GET_ACCOUNT_NAMES',
                address: address
            });
            if (names && names.length > 0) {
                const name = names[0].name;
                addressNameMap[address] = name;
                // Fetch avatar
                fetchAvatarForName(name);
                return name;
            } else {
                const truncatedAddress = address.substring(0, 5) + '...' + address.substring(address.length - 5);
                addressNameMap[address] = truncatedAddress;
                return truncatedAddress;
            }
        } catch (error) {
            console.error('Error fetching name for address:', error);
            const truncatedAddress = address.substring(0, 5) + '...' + address.substring(address.length - 5);
            addressNameMap[address] = truncatedAddress;
            return truncatedAddress;
        }
    }
}

function fetchAvatarForName(name) {
    if (avatarCache[name]) return; // Avatar already cached
    const avatarUrl = `/arbitrary/THUMBNAIL/${name}/qortal_avatar`;
    const img = new Image();
    img.src = avatarUrl;
    img.onload = function() {
        avatarCache[name] = avatarUrl;
    };
    img.onerror = function() {
        // Use a default avatar or do nothing
        avatarCache[name] = 'default-avatar.png'; // Ensure you have a default avatar image
    };
}

// Send a message to groupId 0
function sendMessage() {
    const messageInput = document.getElementById('message-input');
    const message = messageInput.value.trim();
    if (message === '') return;
    // Disable the send button and message input
    document.getElementById('send-button').disabled = true;
    messageInput.disabled = true;
    // Dim the input area
    document.getElementById('chat-input').style.opacity = '0.5';
    // Show a note saying "Sending..."
    let sendingNote = document.getElementById('sending-note');
    if (!sendingNote) {
        sendingNote = document.createElement('div');
        sendingNote.id = 'sending-note';
        sendingNote.textContent = 'Sending...';
        sendingNote.style.color = 'gray';
        sendingNote.style.fontStyle = 'italic';
        document.getElementById('chat-input').appendChild(sendingNote);
    }
    // Display logging message: Sending message
    displayLogMessage('Sending message...');
    // Send group message to groupId 0
    qortalRequest({
        action: "SEND_CHAT_MESSAGE",
        groupId: "0", // send to groupId 0
        message: message
    }).then(response => {
        // Check if response is true
        if (response === true) {
            // Clear the input field upon successful send
            messageInput.value = '';
            // Display logging message: Message sent
            displayLogMessage('Message sent successfully.');
            // Reload messages and users
            loadMessagesAndUsers();
        } else {
            // Handle unexpected response
            console.error('Unexpected response from SEND_CHAT_MESSAGE:', response);
            displayLogMessage(`Error sending message: Unexpected response from server.`);
            alert('Error sending message: Unexpected response from server.');
        }
    }).catch(error => {
        console.error('Error sending message:', error);
        displayLogMessage(`Error sending message: ${error}`);
        alert('Error sending message. Please try again.');
    }).finally(() => {
        // Re-enable the send button and message input
        document.getElementById('send-button').disabled = false;
        messageInput.disabled = false;
        // Restore the opacity
        document.getElementById('chat-input').style.opacity = '1';
        // Remove the "Sending..." note
        let sendingNote = document.getElementById('sending-note');
        if (sendingNote) {
            sendingNote.remove();
        }
    });
}

function extractTextFromMessage(node) {
    let resultText = '';
    function traverse(node) {
        if (node.type === 'text') {
            let text = node.text;
            if (node.marks) {
                for (let mark of node.marks) {
                    if (mark.type === 'bold') {
                        text = '<b>' + text + '</b>';
                    } else if (mark.type === 'italic') {
                        text = '<i>' + text + '</i>';
                    } else if (mark.type === 'underline') {
                        text = '<u>' + text + '</u>';
                    }
                    // Add more formatting as needed
                }
            }
            resultText += text;
        } else if (node.type === 'paragraph') {
            if (node.content && Array.isArray(node.content)) {
                node.content.forEach(childNode => {
                    traverse(childNode);
                });
            }
            resultText += '<br>';
        } else if (node.type === 'hardBreak') {
            resultText += '<br>';
        } else if (node.type === 'heading') {
            let level = node.attrs && node.attrs.level ? node.attrs.level : 1;
            resultText += `<h${level}>`;
            if (node.content && Array.isArray(node.content)) {
                node.content.forEach(childNode => {
                    traverse(childNode);
                });
            }
            resultText += `</h${level}>`;
        } else if (node.type === 'codeBlock') {
            resultText += '<pre>';
            if (node.content && Array.isArray(node.content)) {
                node.content.forEach(childNode => {
                    traverse(childNode);
                });
            }
            resultText += '</pre>';
        } else if (node.content && Array.isArray(node.content)) {
            node.content.forEach(childNode => {
                traverse(childNode);
            });
        }
    }
    traverse(node);
    return resultText;
}

function formatTimestamp(timestamp) {
    let date = new Date(timestamp);
    return date.toLocaleTimeString(); // Adjust format as needed
}

// Base58 encoding and decoding using bs58
function base58Decode(string) {
    return bs58.decode(string);
}

function base58Encode(buffer) {
    return bs58.encode(buffer);
}

// Convert hex string to Uint8Array
function hexToUint8Array(hexString) {
    if (hexString.length % 2 !== 0) {
        hexString = '0' + hexString;
    }
    const byteArray = new Uint8Array(hexString.length / 2);
    for (let i = 0; i < byteArray.length; i++) {
        byteArray[i] = parseInt(hexString.substr(i * 2, 2), 16);
    }
    return byteArray;
}

// Start the application
init();
