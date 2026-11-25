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

let sendQueue = Promise.resolve();

function queueSend(task) {
    const result = sendQueue.then(task);

    sendQueue = result.catch(() => {});

    return result;
}

let sock = null;
let qr = null;
let connected = false;
let reconnectTimer = null;
let starting = false;

async function startWhatsApp() {
    if (starting) {
        console.log('WhatsApp start already in progress');
        return;
    }

    starting = true;

    try {
        const { state, saveCreds } =
            await useMultiFileAuthState(SESSION_DIR);

        const newSock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
        });

		if (sock && sock !== newSock) {
			try {
				sock.end(undefined);
			} catch (e) {
				console.error('Error closing old socket:', e);
			}
		}

        sock = newSock;

        newSock.ev.on('creds.update', saveCreds);

        newSock.ev.on('connection.update', (update) => {
            const {
                connection,
                lastDisconnect,
                qr: newQr
            } = update;

            if (newQr) {
                qr = newQr;
                console.log('New WhatsApp QR generated');
            }

            if (connection === 'open') {
                connected = true;
                qr = null;
                starting = false;

                console.log('WhatsApp connected');
            }

            if (connection === 'close') {
                connected = false;

                // Не даём старому socket оставаться активным
                if (sock === newSock) {
                    sock = null;
                }

                starting = false;

                const statusCode =
                    lastDisconnect?.error?.output?.statusCode;

                console.error(
					'WhatsApp disconnected:',
					{
						statusCode,
						reason: lastDisconnect?.error?.message,
						error: lastDisconnect?.error,
					}
				);

                if (statusCode !== DisconnectReason.loggedOut) {
                    if (!reconnectTimer) {
                        reconnectTimer = setTimeout(() => {
                            reconnectTimer = null;
                            startWhatsApp();
                        }, 3000);
                    }
                } else {
                    console.log('WhatsApp logged out');
                }
            }
        });

    } catch (error) {
        starting = false;

        console.error(
            'WhatsApp start error:',
            error
        );

        if (!reconnectTimer) {
            reconnectTimer = setTimeout(() => {
                reconnectTimer = null;
                startWhatsApp();
            }, 3000);
        }
    }
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
        if (!connected || !sock) {
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

        const result = await queueSend(async () => {
            if (!connected || !sock) {
                throw new Error('WhatsApp disconnected');
            }

            console.log(`Sending WhatsApp message to ${jid}`);

            return await sock.sendMessage(jid, {
                text: message,
            });
        });

        res.json({
            success: true,
            message_id: result?.key?.id,
        });

    } catch (error) {
        console.error('WhatsApp send error:', error);

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