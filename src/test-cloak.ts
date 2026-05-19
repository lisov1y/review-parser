import { launch } from 'cloakbrowser';

async function main() {
  const browser = await launch({
    headless: false
  });

  const page = await browser.newPage();

  await page.goto('https://yandex.ru/maps/', {
    waitUntil: 'domcontentloaded'
  });

  console.log('Title:', await page.title());

  await page.waitForTimeout(5000);
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});