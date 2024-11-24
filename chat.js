// Toggle logs for testing
const enableLogging = false;

// Variables to store user data and state
let userAccount = null;
let userAddress = null;
let userPublicKey = null;
let userName = null;
let groupMessages = [];
let isLoggedIn = false;
// Cache for address-to-name mapping
let addressNameMap = {};

// Initialize the application
async function init() {
    document.getElementById('login-button').addEventListener('click', login);
    document.getElementById('send-button').addEventListener('click', sendMessage);
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
            processedMessages++;
            // Display logging message: Message processing progress
            displayLogMessage(`Displaying message ${processedMessages} of ${messagesToDisplay.length}...`);
            const messageElement = document.createElement('div');
            const senderName = await getNameForAddress(msg.sender);
            // Collect active users
            activeUsers.add(msg.sender);
            // Decode the message data
            let messageContent = '';
            if (msg.isEncrypted) {
                messageContent = '[Encrypted Message]';
            } else {
                try {
                    const decodedBytes = base58Decode(msg.data);
                    const jsonString = new TextDecoder().decode(decodedBytes);
                    const messageObject = JSON.parse(jsonString);
                    messageContent = extractTextFromMessage(messageObject.messageText);
                } catch (e) {
                    messageContent = '[Unable to decode message]';
                }
            }
            // Format the timestamp
            const formattedTimestamp = formatTimestamp(msg.timestamp);
            // Include timestamp in the displayed message
            messageElement.innerHTML = `${formattedTimestamp} ${senderName}: ${messageContent}`;
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
            processedUsers++;
            // Display logging message: User processing progress
            displayUserLogMessage(`Processing user ${processedUsers} of ${activeUsers.size}...`);
            const userItem = document.createElement('li');
            const name = await getNameForAddress(user);
            userItem.textContent = name;
            userItem.classList.add('user-item');
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
        // Disable send button and message input
        document.getElementById('send-button').disabled = true;
        document.getElementById('message-input').disabled = true;
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
            // Enable send button and message input
            document.getElementById('send-button').disabled = false;
            document.getElementById('message-input').disabled = false;
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
                return name;
            } else {
                addressNameMap[address] = address;
                return address;
            }
        } catch (error) {
            console.error('Error fetching name for address:', error);
            addressNameMap[address] = address;
            return address;
        }
    }
}

// Send a message to groupId 0
function sendMessage() {
    if (!isLoggedIn) {
        alert('You must be logged in to send messages.');
        return;
    }
    const messageInput = document.getElementById('message-input');
    const message = messageInput.value.trim();
    if (message === '') return;
    // Display logging message: Sending message
    displayLogMessage('Sending message...');
    // Create the message object in the required format
    const messageObject = {
        messageText: {
            type: 'doc',
            content: [
                {
                    type: 'paragraph',
                    content: [
                        {
                            type: 'text',
                            text: message
                        }
                    ]
                }
            ]
        },
        images: [""],
        repliedTo: "",
        version: 3
    };
    // Convert the message object to JSON string
    const jsonString = JSON.stringify(messageObject);
    const uint8Array = new TextEncoder().encode(jsonString);
    const base58Encoded = base58Encode(uint8Array);
    // Send group message to groupId 0
    qortalRequest({
        action: "SEND_CHAT_MESSAGE",
        groupId: 0, // send to groupId 0
        message: base58Encoded
    }).then(() => {
        // Clear the input field upon successful send
        messageInput.value = '';
        // Display logging message: Message sent
        displayLogMessage('Message sent successfully.');
        // Reload messages and users
        loadMessagesAndUsers();
    }).catch(error => {
        console.error('Error sending message:', error);
        displayLogMessage(`Error sending message: ${error}`);
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
