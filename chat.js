// Toggle logs for testing
const enableLogging = false;

// Variables to store user data and state
let userAccount = null;
let userAddress = null;
let userPublicKey = null;
let userName = null;
let groupMessages = [];
let isLoggedIn = false;
let refreshIntervalId = null;
// Cache for address & avatar mapping
let addressNameMap = {};
let avatarCache = {};
// To keep track of selected users
let selectedUsers = new Set();

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
    refreshIntervalId = setInterval(loadMessagesAndUsers, 15000); // Refresh every 15 seconds
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
        const chatMessages = document.getElementById('chat-messages');
        // Check if the user is at the bottom before updating messages
        const isAtBottom = chatMessages.scrollHeight - chatMessages.clientHeight - chatMessages.scrollTop <= 50;
        // Fetch messages for groupId 0
        const messages = await qortalRequest({
            action: 'SEARCH_CHAT_MESSAGES',
            txGroupId: 0
        });
        groupMessages = messages;
        // Build message map to handle edits
        let messageMap = {};
        for (let msg of groupMessages) {
            let messageId = msg.chatReference || msg.signature;
            let existingMessage = messageMap[messageId];
            if (!existingMessage || msg.timestamp > existingMessage.timestamp) {
                messageMap[messageId] = msg;
            }
        }
        // Get all messages and sort them by timestamp
        let allMessages = Object.values(messageMap);
        allMessages.sort((a, b) => a.timestamp - b.timestamp);
        // Build set of all active users from all messages (before filtering)
        let allActiveUsers = new Set();
        for (let msg of allMessages) {
            allActiveUsers.add(msg.sender);
        }
        // Now filter messagesToDisplay based on selected users
        let messagesToDisplay = allMessages;
        if (selectedUsers.size > 0) {
            messagesToDisplay = messagesToDisplay.filter(msg => selectedUsers.has(msg.sender));
        }
        // Display messages
        chatMessages.innerHTML = '';
        for (let msg of messagesToDisplay) {
            const messageElement = document.createElement('div');
            messageElement.classList.add('message-item');
            const senderName = await getNameForAddress(msg.sender);
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
                    // Extract text from messageText
                    messageText = extractTextFromMessage(messageObject.messageText);
                    // Handle embedded images
                    if (messageObject.images && Array.isArray(messageObject.images) && (messageObject.images[0] !== "")) {
                        for (let image of messageObject.images) {
                            const imageUrl = `/arbitrary/${image.service}/${image.name}/${image.identifier}`;
                            messageText += `<br><img src="${imageUrl}" alt="Embedded Image">`;
                        }
                    }
                    // Process qortal:// links within the message text
                    messageText = processQortalLinks(messageText);
                } catch (e) {
                    messageText = '[Unable to decode message]';
                }
            }
            messageContent.innerHTML = `<strong>${senderName}</strong> <span style="color: gray; font-size: 0.8em;">${formatTimestamp(msg.timestamp)}</span><br>${messageText}`;
            // Append avatar and content to message element
            messageElement.appendChild(avatarImg);
            messageElement.appendChild(messageContent);
            chatMessages.appendChild(messageElement);
        }
        // Scroll to the bottom if the user was at the bottom
        if (isAtBottom) {
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
        // Update the user list with all active users
        updateUserList(allActiveUsers);
    } catch (error) {
        console.error('Error loading messages and users:', error);
        displayLogMessage(`Error loading messages and users: ${error}`);
    }
}

function updateUserList(activeUsers) {
    const userList = document.getElementById('user-list');
    userList.innerHTML = '';
    for (let user of activeUsers) {
        const userItem = document.createElement('li');
        userItem.classList.add('user-item');
        const userName = addressNameMap[user] || user;
        // Highlight selected users
        if (selectedUsers.has(user)) {
            userItem.classList.add('selected-user');
        }
        const avatarImg = document.createElement('img');
        avatarImg.src = avatarCache[userName] || 'default-avatar.png';
        const userNameSpan = document.createElement('span');
        userNameSpan.textContent = userName;
        userItem.appendChild(avatarImg);
        userItem.appendChild(userNameSpan);
        // Add click event listener
        userItem.addEventListener('click', () => {
            if (selectedUsers.has(user)) {
                selectedUsers.delete(user);
                userItem.classList.remove('selected-user');
            } else {
                selectedUsers.add(user);
                userItem.classList.add('selected-user');
            }
            // Reload messages with filtering
            loadMessagesAndUsers();
        });
        userList.appendChild(userItem);
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
    // Stop the periodic refresh
    clearInterval(refreshIntervalId);
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
        // If the response is not an error, treat it as success
        if (response && !response.error) {
            // Clear the input field upon successful send
            messageInput.value = '';
            // Display logging message: Message sent
            displayLogMessage('Message sent successfully.');
            // Log the response for further investigation
            console.log('Response from SEND_CHAT_MESSAGE:', response);
            displayLogMessage(`Response: ${JSON.stringify(response)}`);
            // Reload messages and users
            loadMessagesAndUsers();
        } else {
            // Handle unexpected response
            console.error('Unexpected response from SEND_CHAT_MESSAGE:', response);
            displayLogMessage(`Unexpected response: ${JSON.stringify(response)}`);
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
        // Restart the periodic refresh
        refreshIntervalId = setInterval(loadMessagesAndUsers, 15000);
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
            // Process qortal:// links in the text
            text = processQortalLinks(text);
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

function processQortalLinks(text) {
    // Use a regular expression to find qortal:// links
    return text.replace(/qortal:\/\/[^\s<>"']+/g, function(match) {
        const displayText = escapeHtml(match);
        const encodedLink = encodeURIComponent(match);
        // Extract the service, name, and identifier
        const path = match.substring('qortal://'.length);
        const parts = path.split('/');
        const service = parts[0];
        const name = parts[1];
        const identifier = parts.slice(2).join('/'); // In case identifier contains slashes
        // Handle 'use-group/action-join/groupid-XXX' links
        if (service === 'use-group' && name === 'action-join') {
            return `<a href="#" style="color: dodgerblue; text-decoration: underline;" onclick="joinGroup('${encodedLink}'); return false;">${displayText}</a>`;
        }
        // For APP and WEBSITE service types
        else if (service === 'APP' || service === 'WEBSITE') {
            return `<a href="#" style="color: dodgerblue; text-decoration: underline;" onclick="openQortalLink('${encodedLink}'); return false;">${displayText}</a>`;
        }
        // For embeddable service types
        else if (['THUMBNAIL', 'QCHAT_IMAGE', 'IMAGE', 'VIDEO', 'AUDIO', 'QCHAT_AUDIO', 'VOICE', 'BLOG', 'BLOG_POST', 'BLOG_COMMENT', 'DOCUMENT'].includes(service)) {
            const url = `/arbitrary/${service}/${name}/${identifier}`;
            // Decide how to embed based on service type
            if (['IMAGE', 'THUMBNAIL', 'QCHAT_IMAGE'].includes(service)) {
                return `<img src="${url}" alt="${displayText}">`;
            } else if (['VIDEO'].includes(service)) {
                return `<video controls src="${url}"></video>`;
            } else if (['AUDIO', 'QCHAT_AUDIO', 'VOICE'].includes(service)) {
                return `<audio controls src="${url}"></audio>`;
            } else {
                return `<a href="#" onclick="openQortalLink('${encodedLink}'); return false;">${displayText}</a>`;
            }
        } else {
            // Default action for other service types
            return `<a href="#" style="color: dodgerblue; text-decoration: underline;" onclick="openQortalLink('${encodedLink}'); return false;">${displayText}</a>`;
        }
    });
}

function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function openQortalLink(encodedQortalLink) {
    const qortalLink = decodeURIComponent(encodedQortalLink);
    qortalRequest({
        action: 'OPEN_NEW_TAB',
        qortalLink: qortalLink
    }).then(response => {
        // Optionally handle the response
    }).catch(error => {
        console.error('Error opening Qortal link:', error);
    });
}

function joinGroup(encodedQortalLink) {
    const qortalLink = decodeURIComponent(encodedQortalLink);
    const path = qortalLink.substring('qortal://'.length);
    const parts = path.split('/');
    const service = parts[0]; // Should be 'use-group'
    const action = parts[1];  // Should be 'action-join'
    const groupIdPart = parts[2]; // Should be 'groupid-XXX'
    // Extract groupId from 'groupid-XXX'
    const groupIdMatch = groupIdPart.match(/groupid-(\d+)/);
    if (groupIdMatch && groupIdMatch[1]) {
        const groupId = parseInt(groupIdMatch[1], 10);
        // Call the JOIN_GROUP action
        qortalRequest({
            action: "JOIN_GROUP",
            groupId: groupId
        }).then(response => {
            if (response === true || (response && !response.error)) {
                alert(`Successfully joined group ${groupId}.`);
            } else {
                console.error('Error joining group:', response);
                alert('Error joining group. Please try again.');
            }
        }).catch(error => {
            console.error('Error joining group:', error);
            alert('Error joining group. Please try again.');
        });
    } else {
        alert('Invalid group link.');
    }
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
