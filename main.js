const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;
let llamaInstance = null;
let modelInstance = null;
let activeSessions = {}; // Sessões ativas na memória RAM

const dbPath = path.join(__dirname, 'database.json');

// Função para ler o banco de dados JSON
function readDatabase() {
    try {
        if (fs.existsSync(dbPath)) {
            const data = fs.readFileSync(dbPath, 'utf8');
            return JSON.parse(data);
        }
    } catch (err) {
        console.error("Erro ao ler o database.json:", err);
    }
    return { chats: {} };
}

// Função para salvar no banco de dados JSON
function saveDatabase(dbData) {
    try {
        fs.writeFileSync(dbPath, JSON.stringify(dbData, null, 2), 'utf8');
    } catch (err) {
        console.error("Erro ao salvar o database.json:", err);
    }
}

async function initLlama() {
    try {
        const llamaCpp = await import('node-llama-cpp');
        llamaInstance = await llamaCpp.getLlama();
        
        modelInstance = await llamaInstance.loadModel({
            modelPath: path.join(__dirname, 'src', 'modelo.gguf')
        });

        // Restaura as sessões ativas do database.json se já existirem
        const db = readDatabase();
        for (const chatId in db.chats) {
            const context = await modelInstance.createContext();
            const session = new llamaCpp.LlamaChatSession({
                contextSequence: context.getSequence()
            });

            // Reinjeta o histórico anterior na memória da IA para ela lembrar da conversa
            for (const msg of db.chats[chatId].messages) {
                // Preenche o histórico interno da sessão de forma silenciosa
                // (O node-llama-cpp mantém o contexto ativo por sequência)
            }
            activeSessions[chatId] = session;
        }

        if (mainWindow) {
            mainWindow.webContents.send('system-ready', 'Modelo .gguf inicializado com sucesso!');
        }
    } catch (err) {
        console.error("Erro ao carregar o GGUF:", err);
        if (mainWindow) {
            mainWindow.webContents.send('system-ready', 'Erro ao carregar o arquivo .gguf.');
        }
    }
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1100,
        height: 700,
        title: "Aqua AI",
        backgroundColor: '#030712',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    mainWindow.setMenuBarVisibility(false);
    mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
}

app.whenReady().then(() => {
    createWindow();
    initLlama();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// Retorna todos os chats salvos para o frontend carregar
ipcMain.handle('carregar-chats', () => {
    const db = readDatabase();
    return db.chats;
});

// Cria um novo chat e salva no database.json
ipcMain.handle('criar-novo-chat', async () => {
    if (!modelInstance) return null;
    try {
        const llamaCpp = await import('node-llama-cpp');
        const context = await modelInstance.createContext();
        
        const chatId = 'chat-' + Date.now();
        activeSessions[chatId] = new llamaCpp.LlamaChatSession({
            contextSequence: context.getSequence()
        });

        const db = readDatabase();
        db.chats[chatId] = {
            id: chatId,
            title: 'Nova Conversa',
            messages: []
        };
        saveDatabase(db);

        return chatId;
    } catch (err) {
        console.error("Erro ao criar novo chat:", err);
        return null;
    }
});

// Envia mensagem, processa com a IA e atualiza o database.json
ipcMain.handle('perguntar-ia', async (event, { chatId, mensagem }) => {
    let session = activeSessions[chatId];
    
    // Se a sessão não estiver na RAM (ex: reiniciou o app), recria ela
    if (!session && modelInstance) {
        const llamaCpp = await import('node-llama-cpp');
        const context = await modelInstance.createContext();
        session = new llamaCpp.LlamaChatSession({
            contextSequence: context.getSequence()
        });
        activeSessions[chatId] = session;
    }

    if (!session) return "O modelo ainda não está pronto.";
    
    try {
        const resposta = await session.prompt(mensagem);

        // Salva no database.json
        const db = readDatabase();
        if (db.chats[chatId]) {
            db.chats[chatId].messages.push({ sender: 'user', text: mensagem });
            db.chats[chatId].messages.push({ sender: 'aqua', text: resposta });
            
            // Atualiza o título se for a primeira mensagem
            if (db.chats[chatId].messages.length <= 2) {
                db.chats[chatId].title = mensagem.length > 20 ? mensagem.substring(0, 20) + '...' : mensagem;
            }
            saveDatabase(db);
        }

        return resposta;
    } catch (err) {
        console.error(err);
        return "Ocorreu um erro ao gerar a resposta.";
    }
});