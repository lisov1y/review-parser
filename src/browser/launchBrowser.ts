import {launch} from 'cloakbrowser';

export async function launchBrowser() {
    return await launch({
        headless: process.env.HEADLESS === 'true',
    });
}