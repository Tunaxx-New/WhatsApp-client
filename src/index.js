import express from 'express';
import QRCode from 'qrcode';
import makeWASocket, {
    useMultiFileAuthState,
    DisconnectReason,
} from '@whiskeysockets/baileys';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SESSION_DIR = process.env.SESSION_DIR || '/data/session';

let sock = null;
let qr = null;
let connected = false;

async function startWhatsApp() {
    const { state, saveCreds } =
        await useMultiFileAuthState(SESSION_DIR);

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const {
            connection,
            lastDisconnect,
            qr: newQr,
        } = update;

        if (newQr) {
            qr = newQr;
            console.log('New WhatsApp QR generated');
        }

        if (connection === 'open') {
            connected = true;
            qr = null;

            console.log('WhatsApp connected');
        }

        if (connection === 'close') {
            connected = false;

            const statusCode =
                lastDisconnect?.error?.output?.statusCode;

            if (statusCode !== DisconnectReason.loggedOut) {
                console.log('WhatsApp disconnected, reconnecting...');
                setTimeout(startWhatsApp, 3000);
            } else {
                console.log('WhatsApp logged out');
            }
        }
    });
}

// Status and QR sessions scan
app.get('/whatsapp/status', (req, res) => {
    res.json({
        connected,
        qr_available: qr !== null,
    });
});

app.get('/whatsapp/qr', async (req, res) => {
    if (connected) {
        return res.send(`
            <html>
                <body>
                    <h1>WhatsApp connected</h1>
                </body>
            </html>
        `);
    }

    if (!qr) {
        return res.send(`
            <html>
                <body>
                    <h1>QR code is not ready</h1>
                    <meta http-equiv="refresh" content="2">
                </body>
            </html>
        `);
    }

    const qrDataUrl = await QRCode.toDataURL(qr);

    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>WhatsApp QR</title>
        </head>
        <body>
            <h1>Scan WhatsApp QR</h1>

            <img src="${qrDataUrl}" width="400">

            <p>
                WhatsApp → Связанные устройства →
                Привязать устройство
            </p>

            <script>
                setTimeout(() => location.reload(), 5000);
            </script>
        </body>
        </html>
    `);
});

// Send message
app.post('/whatsapp/send', async (req, res) => {
    try {
        if (!connected) {
            return res.status(503).json({
                error: 'WhatsApp is not connected',
            });
        }

        const { phone, message } = req.body;

        if (!phone || !message) {
            return res.status(400).json({
                error: 'phone and message are required',
            });
        }

        const jid = `${phone}@s.whatsapp.net`;

        const result = await sock.sendMessage(jid, {
            text: message,
        });

        res.json({
            success: true,
            message_id: result?.key?.id,
        });
    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

// Start
startWhatsApp();

app.listen(PORT, () => {
    console.log(`WhatsApp service listening on ${PORT}`);
});