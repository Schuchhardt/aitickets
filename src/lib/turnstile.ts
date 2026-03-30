interface TurnstileOptions {
    token: string;
    remoteip?: string;
    idempotencyKey?: string;
}

export async function verifyTurnstileToken({ token, remoteip, idempotencyKey }: TurnstileOptions): Promise<{ success: boolean; message?: string }> {
    const TURNSTILE_SECRET_KEY = import.meta.env.TURNSTILE_SECRET_KEY;

    if (!TURNSTILE_SECRET_KEY) {
        console.error('TURNSTILE_SECRET_KEY is not configured');
        return { success: false, message: "Error de configuración del servidor" };
    }

    if (!token) {
        return { success: false, message: "Falta validación de CAPTCHA" };
    }

    const verificationUrl = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

    const body: Record<string, string> = {
        secret: TURNSTILE_SECRET_KEY,
        response: token,
    };

    if (remoteip) {
        body.remoteip = remoteip;
    }
    if (idempotencyKey) {
        body.idempotency_key = idempotencyKey;
    }

    try {
        const turnstileRes = await fetch(verificationUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        const turnstileData = await turnstileRes.json();

        if (!turnstileData.success) {
            console.error('Turnstile verification failed:', JSON.stringify(turnstileData));
            const codes = turnstileData['error-codes']?.join(', ') || 'unknown';
            return { success: false, message: `CAPTCHA inválido (${codes})` };
        }

        return { success: true };
    } catch (error) {
        console.error('Turnstile verification error:', error);
        return { success: false, message: "Error al verificar CAPTCHA" };
    }
}
