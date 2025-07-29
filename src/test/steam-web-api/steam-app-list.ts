import axios from 'axios';
import * as fs from 'fs';

// Steam provides a public endpoint for all apps
const APP_LIST_URL = 'https://api.steampowered.com/ISteamApps/GetAppList/v2/';

async function fetchAndSaveSteamApps() {
  try {
    const response = await axios.get(APP_LIST_URL);
    const apps = response.data.applist.apps;

    // Save as JSON
    fs.writeFileSync('steam_apps.json', JSON.stringify(apps, null, 2));
    console.log('Saved steam_apps.json');

    // Save as CSV
    const csvHeader = 'appID,name\n';
    const csvRows = apps.map((app: any) =>
      `"${app.appid}","${app.name.replace(/"/g, '""')}"`
    );
    fs.writeFileSync('steam_apps.csv', csvHeader + csvRows.join('\n'));
    console.log('Saved steam_apps.csv');
  } catch (error: any) {
    console.error('Error fetching app list:', error.message);
  }
}

fetchAndSaveSteamApps();
