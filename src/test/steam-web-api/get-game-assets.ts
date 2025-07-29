import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

// Replace with the target user's SteamID64 and your Steam Web API key
const STEAM_API_KEY = process.env.STEAM_API_KEY;
const STEAM_ID = '76561198218003480'; // Example SteamID64

// Example: Get a user's CS:GO inventory (appid 730, contextid 2)
async function getSteamInventory(steamId: string, appId: string, contextId: string) {
  const url = `https://steamcommunity.com/inventory/${steamId}/${appId}/${contextId}`;
  try {
    const response = await axios.get(url);
    if (response.data && response.data.success) {
      console.log('Inventory items:', response.data.descriptions);
    } else {
      console.log('No inventory or failed to fetch.');
    }
  } catch (error: any) {
    console.error('Error fetching inventory:', error.message);
  }
}

getSteamInventory(STEAM_ID, '730', '2');
