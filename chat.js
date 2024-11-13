// Variables to store user data and state
let userAccount = null;
let userAddress = null;
let userPublicKey = null;
let userName = null;
let userGroups = [];
let activeGroups = [];
let groupMessages = {};
let privateMessagesList = [];
let userPrivateConversations = {};
let currentGroupId = 0; // Default to Qortal General Chat
let currentRecipientAddress = null;
let currentRecipientName = null;
let isLoggedIn = false;
// Cache for address-to-name mapping
let addressNameMap = {};
// Cache for group information
let groupInfoMap = {};

// Initialize the application
async function init() {
    document.getElementById('send-button').disabled = true; // Disable send button by default
    document.getElementById('message-input').disabled = true;
    document.getElementById('login-button').addEventListener('click', login);
    document.getElementById('send-button').addEventListener('click', sendMessage);

    // Load all current chat messages
    await loadChatMessages();

    // Populate the group list
    await populateGroupList();

    // Load messages for the default group
    await selectGroup(currentGroupId);
}

// Load all current chat messages
async function loadChatMessages() {
    try {
        const response = await fetch('/transactions/search?txType=CHAT&confirmationStatus=UNCONFIRMED');
        const messages = await response.json();

        messages.forEach(msg => {
            let groupId = msg.txGroupId;
            if (msg.recipient) {
                // Private message
                privateMessagesList.push(msg);
            } else {
                // Group message
                if (!activeGroups.includes(groupId)) {
                    activeGroups.push(groupId);
                }

                if (!groupMessages[groupId]) {
                    groupMessages[groupId] = [];
                }

                groupMessages[groupId].push(msg);
            }
        });

    } catch (error) {
        console.error('Error loading chat messages:', error);
    }
}

// Populate the group list in the sidebar
// Update function signature to be asynchronous
async function populateGroupList() {
    const groupList = document.getElementById('group-list');
    groupList.innerHTML = '';

    // Add Private Messages at the top with a dropdown
    const pmItem = document.createElement('li');
    pmItem.textContent = 'Private Messages';
    pmItem.classList.add('group-item');
    pmItem.style.fontWeight = 'bold';
    const pmSubList = document.createElement('ul');
    pmSubList.classList.add('nested-list');
    pmSubList.style.display = 'none';
    pmItem.appendChild(pmSubList);

    pmItem.addEventListener('click', () => {
        pmSubList.style.display = pmSubList.style.display === 'none' ? 'block' : 'none';
    });

    groupList.appendChild(pmItem);

    // Add private conversations if logged in
    if (isLoggedIn) {
        for (let otherParty in userPrivateConversations) {
            const conversationItem = document.createElement('li');
            conversationItem.textContent = otherParty;
            conversationItem.classList.add('group-item');
            conversationItem.addEventListener('click', async () => await selectPrivateConversation(otherParty));
            pmSubList.appendChild(conversationItem);
        }

        // Add button to start new private message
        const newPmButton = document.createElement('button');
        newPmButton.textContent = 'New Private Message';
        newPmButton.addEventListener('click', async () => await startNewPrivateMessage);
        pmSubList.appendChild(newPmButton);
    }

    // Add Qortal General Chat
    const generalChatItem = document.createElement('li');
    generalChatItem.textContent = 'Qortal General Chat';
    generalChatItem.classList.add('group-item');
    generalChatItem.addEventListener('click', () => selectGroup(0));
    groupList.appendChild(generalChatItem);

    // Add user's groups
    userGroups.forEach(group => {
        const groupItem = document.createElement('li');
        groupItem.textContent = group.groupName;
        groupItem.classList.add('group-item');
        groupItem.addEventListener('click', () => selectGroup(group.groupId));
        groupList.appendChild(groupItem);
    });

    // Add active groups not joined by user (read-only)
    for (let groupId of activeGroups) {
        if (!isUserMemberOfGroup(groupId) && groupId !== 0 && groupId !== 'private') {
            const groupInfo = await getGroupInfo(groupId);
            const groupItem = document.createElement('li');
            if (groupInfo && groupInfo.groupName) {
                groupItem.textContent = `${groupInfo.groupName} (${groupId})`;
            } else {
                groupItem.textContent = `Group ${groupId} (read-only)`;
            }
            groupItem.classList.add('group-item');
            groupItem.addEventListener('click', () => selectGroup(groupId));
            groupList.appendChild(groupItem);
        }
    }
}

// Handle group selection
async function selectGroup(groupId) {
    currentGroupId = groupId;
    currentRecipientAddress = null; // Reset recipient address

    if (groupId === 'private') {
        // Do nothing here; selection is handled in selectPrivateConversation
        return;
    }

    // Fetch group info and update banner
    const groupInfo = await getGroupInfo(groupId);
    const bannerBar = document.getElementById('group-description-banner');
    if (groupInfo && groupInfo.description) {
        if (bannerBar) {
            bannerBar.textContent = groupInfo.description;
        }
    } else {
        if (bannerBar) {
            bannerBar.textContent = '';
        }
    }

    await loadGroupMessages(groupId);
    await loadGroupMembers(groupId);

    // Update UI
    const groupItems = document.querySelectorAll('.group-item');
    groupItems.forEach(item => item.classList.remove('active'));
    const selectedGroupItem = Array.from(groupItems).find(item => {
        return item.textContent.includes(groupId === 0 ? 'Qortal General Chat' : groupId);
    });
    if (selectedGroupItem) selectedGroupItem.classList.add('active');

    // Enable or disable message input
    if (isLoggedIn && (groupId === 0 || isUserMemberOfGroup(groupId))) {
        document.getElementById('send-button').disabled = false;
        document.getElementById('message-input').disabled = false;
    } else {
        document.getElementById('send-button').disabled = true;
        document.getElementById('message-input').disabled = true;
    }
}

// Load messages for the selected group
async function loadGroupMessages(groupId) {
    const chatMessages = document.getElementById('chat-messages');
    chatMessages.innerHTML = '';

    const messages = groupMessages[groupId] || [];

    for (let msg of messages) {
        const messageElement = document.createElement('div');
        const senderName = await getNameForAddress(msg.sender);

        // Decode the message data
        let messageContent = '';
        if (msg.isEncrypted) {
            messageContent = '[Encrypted Message]';
        } else {
            try {
                // Existing decoding code
                const decodedData = base58Decode(msg.data);
                const textDecoder = new TextDecoder();
                const uint8Array = hexToUint8Array(decodedData);
                const jsonString = textDecoder.decode(uint8Array);
                const messageObject = JSON.parse(jsonString);
                messageContent = extractTextFromMessage(messageObject.messageText);
            } catch (e) {
                messageContent = '[Unable to decode message]';
            }
        }

        messageElement.textContent = `${senderName}: ${messageContent}`;
        chatMessages.appendChild(messageElement);
    }

    // Scroll to the bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Load members for the selected group
// Update function signature to be asynchronous
async function loadGroupMembers(groupId) {
    const userList = document.getElementById('user-list');
    userList.innerHTML = '';

    if (groupId === 'private') {
        // Handle private messages
        return;
    }

    if (groupId === 0) {
        // Qortal General Chat - show active users
        const activeUsers = getActiveUsersInGroup(0);
        for (let user of activeUsers) {
            const userItem = document.createElement('li');
            const name = await getNameForAddress(user);
            userItem.textContent = name;
            userItem.classList.add('user-item');
            userList.appendChild(userItem);
        }
        return;
    }

    try {
        const response = await fetch(`/groups/members/${groupId}`);
        const data = await response.json();
        const members = data.members;

        // Separate admins and other members
        const admins = members.filter(member => member.isAdmin);
        const otherMembers = members.filter(member => !member.isAdmin);

        // Display admins
        if (admins.length > 0) {
            const adminHeader = document.createElement('li');
            adminHeader.textContent = 'Admins';
            adminHeader.style.fontWeight = 'bold';
            userList.appendChild(adminHeader);
            for (let member of admins) {
                const userItem = document.createElement('li');
                const name = await getNameForAddress(member.member);
                userItem.textContent = name;
                userItem.classList.add('user-item');
                userList.appendChild(userItem);
            }
        }

        // Display other members
        if (otherMembers.length > 0) {
            const memberHeader = document.createElement('li');
            memberHeader.textContent = 'Members';
            memberHeader.style.fontWeight = 'bold';
            userList.appendChild(memberHeader);
            for (let member of otherMembers) {
                const userItem = document.createElement('li');
                const name = await getNameForAddress(member.member);
                userItem.textContent = name;
                userItem.classList.add('user-item');
                userList.appendChild(userItem);
            }
        }

    } catch (error) {
        console.error('Error loading group members:', error);
    }
}

// Check if the user is a member of a group
function isUserMemberOfGroup(groupId) {
    if (!isLoggedIn) return false;
    return userGroups.some(group => group.groupId === groupId);
}

// Get active users in a group
function getActiveUsersInGroup(groupId) {
    const messages = groupMessages[groupId] || [];
    const users = new Set();
    messages.forEach(msg => {
        users.add(msg.senderName || msg.sender);
    });
    return Array.from(users);
}

// Handle user login
async function login() {
    try {
        const account = await qortalRequest({
            action: "GET_USER_ACCOUNT"
        });
        userAccount = account;
        userAddress = account.address;
        userPublicKey = account.publicKey;
        isLoggedIn = true;

        // Get user name
        await getUserName();

        // Get groups the user is a member of
        await getUserGroups();

        // Process private messages involving the user
        processPrivateMessages();

        // Update the group list
        await populateGroupList();

        // Enable message input if applicable
        if (isUserMemberOfGroup(currentGroupId) || currentGroupId === 0) {
            document.getElementById('send-button').disabled = false;
            document.getElementById('message-input').disabled = false;
        }

    } catch (error) {
        console.error('Error during login:', error);
    }
}

// Get the user's registered name
async function getUserName() {
    try {
        const response = await fetch(`/names/address/${userAddress}`);
        const names = await response.json();
        if (names.length > 0) {
            userName = names[0].name;
        } else {
            userName = userAddress;
        }
    } catch (error) {
        console.error('Error getting user name:', error);
    }
}

// Get groups the user is a member of
async function getUserGroups() {
    try {
        const response = await fetch(`/groups/member/${userAddress}`);
        userGroups = await response.json();
    } catch (error) {
        console.error('Error getting user groups:', error);
    }
}

// Function to get the name for an address
async function getNameForAddress(address) {
    if (addressNameMap[address]) {
        return addressNameMap[address];
    } else {
        try {
            const response = await fetch(`/names/address/${address}`);
            const names = await response.json();
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

// Function to get group info for a groupId
async function getGroupInfo(groupId) {
    if (groupInfoMap[groupId]) {
        return groupInfoMap[groupId];
    } else {
        try {
            const response = await fetch(`/groups/${groupId}`);
            const groupInfo = await response.json();
            groupInfoMap[groupId] = groupInfo;
            return groupInfo;
        } catch (error) {
            console.error('Error fetching group info:', error);
            return null;
        }
    }
}

// Process private messages involving the user
function processPrivateMessages() {
    userPrivateConversations = {};
    privateMessagesList.forEach(msg => {
        if (msg.sender === userAddress || msg.recipient === userAddress) {
            const otherParty = msg.sender === userAddress ? msg.recipient : msg.sender;
            if (!userPrivateConversations[otherParty]) {
                userPrivateConversations[otherParty] = [];
            }
            userPrivateConversations[otherParty].push(msg);
        }
    });
}

// Select a private conversation
async function selectPrivateConversation(otherParty) {
    currentGroupId = 'private';
    currentRecipientAddress = otherParty;
    currentRecipientName = await getNameForAddress(otherParty); // Get the name for the other party
    await loadPrivateMessages(otherParty);

    // Update UI
    const groupItems = document.querySelectorAll('.group-item');
    groupItems.forEach(item => item.classList.remove('active'));
    // Highlight the selected private conversation if necessary
}

// Load private messages with the selected user
async function loadPrivateMessages(otherParty) {
    const chatMessages = document.getElementById('chat-messages');
    chatMessages.innerHTML = '';

    const messages = userPrivateConversations[otherParty] || [];

    // Sort messages by timestamp
    messages.sort((a, b) => a.timestamp - b.timestamp);

    for (let msg of messages) {
        const messageElement = document.createElement('div');
        const senderName = await getNameForAddress(msg.sender);

        // Decrypt the message data
        let messageContent = '';
        if (msg.isEncrypted) {
            // Decrypt the message using qortalRequest
            messageContent = '[Encrypted Message]'; // Placeholder
        } else {
            messageContent = '[Cannot display unencrypted private message]';
        }

        messageElement.textContent = `${senderName}: ${messageContent}`;
        chatMessages.appendChild(messageElement);
    }

    // Scroll to the bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // Enable or disable message input
    if (isLoggedIn) {
        document.getElementById('send-button').disabled = false;
        document.getElementById('message-input').disabled = false;
    } else {
        document.getElementById('send-button').disabled = true;
        document.getElementById('message-input').disabled = true;
    }
}

// Start a new private message
async function startNewPrivateMessage() {
    const recipientAddress = prompt('Enter the recipient\'s address:');
    if (recipientAddress) {
        await selectPrivateConversation(recipientAddress);
    }
}

// Send a message
function sendMessage() {
    const messageInput = document.getElementById('message-input');
    const message = messageInput.value.trim();
    if (message === '') return;
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
    // Encode the JSON string to Uint8Array and then to Base58
    const textEncoder = new TextEncoder();
    const uint8Array = textEncoder.encode(jsonString);
    const hexString = Array.from(uint8Array).map(b => b.toString(16).padStart(2, '0')).join('');
    const base58Encoded = base58Encode(hexString);
    if (currentGroupId === 'private') {
        // Send private message
        qortalRequest({
            action: "SEND_CHAT_MESSAGE",
            destinationAddress: currentRecipientAddress,
            message: base58Encoded
        }).then(() => {
            // Handle success
        }).catch(error => {
            console.error('Error sending message:', error);
        });
    } else {
        // Send group message
        qortalRequest({
            action: "SEND_CHAT_MESSAGE",
            groupId: currentGroupId,
            message: base58Encoded
        }).then(() => {
            // Handle success
        }).catch(error => {
            console.error('Error sending message:', error);
        });
    }
}

function extractTextFromMessage(messageText) {
    let resultText = '';

    function traverse(node) {
        if (node.type === 'text') {
            resultText += node.text;
        } else if (node.content && Array.isArray(node.content)) {
            node.content.forEach(childNode => {
                traverse(childNode);
                if (childNode.type === 'paragraph') {
                    resultText += '\n';
                }
            });
        }
    }

    traverse(messageText);
    return resultText.trim();
}

// Base58 decoding function
function base58Decode(s) {
    const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let decoded = BigInt(0);
    let multi = BigInt(1);
    for (let i = s.length - 1; i >= 0; i--) {
        const index = alphabet.indexOf(s[i]);
        if (index === -1) {
            throw new Error('Invalid base58 character');
        }
        decoded += BigInt(index) * multi;
        multi *= BigInt(58);
    }
    return decoded.toString(16).padStart(2, '0');
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
