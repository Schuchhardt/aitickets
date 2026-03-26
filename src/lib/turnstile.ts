export async function verifyTurnstileToken(token: string): Promise<{ success: boolean; message?: string }> {
    const TURNSTILE_SECRET_KEY = import.meta.env.TURNSTILE_SECRET_KEY || '1x0000000000000000000000000000000AA'; // Test key fallback

    if (!token) {
        return { success: false, message: "Falta validación de CAPTCHA" };
    }

    const verificationUrl = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
    const formData = new FormData();
    formData.append('secret', TURNSTILE_SECRET_KEY);
    formData.append('response', token);

    try {
        const turnstileRes = await fetch(verificationUrl, {
            method: 'POST',
            body: formData,
        });

        const turnstileData = await turnstileRes.json();

        if (!turnstileData.success) {
            console.error('Turnstile verification failed:', turnstileData);
            return { success: false, message: "CAPTCHA inválido" };
        }

        return { success: true };
    } catch (error) {
        console.error('Turnstile verification error:', error);
        return { success: false, message: "Error al verificar CAPTCHA" };
    }
}
