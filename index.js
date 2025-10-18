// Import necessary modules
const express = require('express');
const path = require('path');
const cors = require('cors');
const WebSocket = require('ws');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

// --- AI Scraper Class (Provided by you) ---
class Copilot {
    constructor() {
        this.conversationId = null;
        this.models = {
            default: 'chat',
            'think-deeper': 'reasoning',
            'gpt-5': 'smart'
        };
        this.headers = {
            origin: 'https://copilot.microsoft.com',
            'user-agent': 'Mozilla/5.0 (Linux; Android 15; SM-F958 Build/AP3A.240905.015) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.86 Mobile Safari/537.36'
        };
    }

    async createConversation() {
        try {
            let { data } = await axios.post('https://copilot.microsoft.com/c/api/conversations', null, { headers: this.headers });
            this.conversationId = data.id;
            return this.conversationId;
        } catch (error) {
            console.error("Error creating conversation:", error.message);
            throw new Error("Failed to create a new conversation with the AI service.");
        }
    }

    async chat(message, { model = 'default' } = {}) {
        // This check ensures a conversation is always available.
        if (!this.conversationId) await this.createConversation();
        if (!this.models[model]) throw new Error(`Available models: ${Object.keys(this.models).join(', ')}`);
        
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(`wss://copilot.microsoft.com/c/api/chat?api-version=2&features=-,ncedge,edgepagecontext&setflight=-,ncedge,edgepagecontext&ncedge=1`, { headers: this.headers });
            const response = { text: '', citations: [] };
            
            ws.on('open', () => {
                ws.send(JSON.stringify({
                    event: 'setOptions',
                    supportedFeatures: ['partial-generated-images'],
                    supportedCards: ['weather', 'local', 'image', 'sports', 'video', 'ads', 'safetyHelpline', 'quiz', 'finance', 'recipe'],
                    ads: { supportedTypes: ['text', 'product', 'multimedia', 'tourActivity', 'propertyPromotion'] }
                }));
                ws.send(JSON.stringify({
                    event: 'send',
                    mode: this.models[model],
                    conversationId: this.conversationId,
                    content: [{ type: 'text', text: message }],
                    context: {}
                }));
            });

            ws.on('message', (chunk) => {
                try {
                    const parsed = JSON.parse(chunk.toString());
                    switch (parsed.event) {
                        case 'appendText':
                            response.text += parsed.text || '';
                            break;
                        case 'citation':
                            response.citations.push({ title: parsed.title, icon: parsed.iconUrl, url: parsed.url });
                            break;
                        case 'done':
                            resolve(response);
                            ws.close();
                            break;
                        case 'error':
                            reject(new Error(parsed.message || 'An unknown error occurred during the AI chat.'));
                            ws.close();
                            break;
                    }
                } catch (error) {
                    reject(new Error('Failed to process message from AI service.'));
                }
            });
            
            ws.on('error', (err) => {
                reject(new Error(`WebSocket error: ${err.message}`));
            });
        });
    }
}

// --- Express Server Setup ---
const app = express();
const PORT = process.env.PORT || 3000;

// *** PERFORMANCE OPTIMIZATION: Create a single, reusable Copilot instance ***
// This instance will persist and reuse its conversationId across multiple API calls,
// significantly speeding up responses by avoiding new conversation setup for each request.
const copilot = new Copilot();

app.use(cors());
app.use(express.json());

// --- API Endpoint (Optimized) ---
app.post('/api/ai', async (req, res) => {
    const { query, customModel, language } = req.body;

    if (!query || typeof query !== 'string' || query.trim() === '') {
        return res.status(400).json({ 
            success: false, 
            error: "Bad Request: 'query' field is missing or empty." 
        });
    }

    try {
        const startTime = Date.now();
        
        // --- Prompt Engineering ---
        let instructions = [];
        if (customModel && customModel.trim() !== '') {
            instructions.push(`Anda adalah AI yang harus berperan sebagai: "${customModel}". Pertahankan karakter ini dalam jawaban Anda.`);
        }
        // Always include language instruction since we have a default now.
        const outputLanguage = language || 'Indonesia'; // Fallback just in case
        instructions.push(`Anda harus menjawab secara eksklusif dalam Bahasa ${outputLanguage}.`);

        let finalPrompt = `${instructions.join(' ')}\n\n---\n\nPERTANYAAN:\n${query}`;

        // Use the single, persistent copilot instance for the chat.
        const aiResponse = await copilot.chat(finalPrompt);
        const duration = Date.now() - startTime;
        
        const responseText = aiResponse.text.trim();
        const citations = aiResponse.citations || [];

        const metadata = {
            queryLength: query.length,
            finalPromptLength: finalPrompt.length,
            responseLength: responseText.length,
            citationCount: citations.length,
            executionTime: `${duration}ms`,
            timestamp: new Date().toISOString(),
            modelUsed: 'default',
            customCharacter: customModel || 'Tidak diatur',
            outputLanguage: outputLanguage
        };
        
        res.json({
            success: true,
            response: responseText,
            citations,
            metadata
        });

    } catch (error) {
        console.error("API Error:", error);
        res.status(500).json({ 
            success: false, 
            error: "Internal Server Error",
            message: error.message 
        });
    }
});

// --- Serve Frontend ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Fallback for 404 Not Found
app.use((req, res) => {
    res.status(404).send("Error 404: Not Found");
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
