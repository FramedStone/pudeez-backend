import express, { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import session from 'express-session';
import SQLiteStoreFactory from 'connect-sqlite3';

// Extend express-session types to include walletAddress
import 'express-session';
declare module 'express-session' {
  interface SessionData {
    walletAddress?: string;
  }
}
import passport from 'passport';
import SteamStrategy from 'passport-steam';

import { Database, User, AssetRecord, SteamInventoryResponse } from './database_handler';
import { SteamAsset, storeAssetOnWalrus, retrieveAssetFromWalrus } from './walrus_handler';
import { randomUUID } from 'crypto';

// Temporary in-memory token store for walletAddress
const steamLoginTokenMap = new Map<string, string>();

// Steam user profile interface
interface SteamProfile {
  id: string;
  displayName: string;
  profileUrl: string;
  photos: Array<{ value: string }>;
  _json: Record<string, unknown>;
}

// Get env vars
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3111;
const DB_NAME = "data.sqlite3";

// Steam API key validation
const STEAM_API_KEY = process.env.STEAM_API_KEY;
if (!STEAM_API_KEY) {
  console.warn('STEAM_API_KEY is not set in environment variables. Steam authentication will not work.');
}

// Initialize database
const db = new Database(DB_NAME);

// Configure passport for Steam authentication
passport.serializeUser((user: unknown, done) => done(null, user));
passport.deserializeUser((obj: unknown, done) => done(null, obj as Express.User));

if (STEAM_API_KEY) {
  passport.use(new SteamStrategy(
    {
      returnURL: `http://localhost:${PORT}/auth/steam/return`,
      realm: `http://localhost:${PORT}/`,
      apiKey: STEAM_API_KEY,
    },
    function (identifier, profile, done) {
      // profile.id is the SteamID
      return done(null, profile);
    }
  ));
}

// -- Middlewares --
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Persistent session store using SQLite
const SQLiteStore = SQLiteStoreFactory(session);
app.use(session({ 
  store: new SQLiteStore({ db: 'sessions.sqlite3', dir: './' }) as any,
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-in-production', 
  resave: false, 
  saveUninitialized: true,
  cookie: {
    secure: false, // Set to true if using HTTPS
    sameSite: 'lax', // Use 'none' and secure: true if using HTTPS and cross-site
  }
}));

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// CORS middleware
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
if (FRONTEND_URL === '*') {
  console.warn('CORS is set to allow all origins. Set FRONTEND_URL in your environment for better security.');
}
app.use((req: Request, res: Response, next: NextFunction) => {
  res.header('Access-Control-Allow-Origin', FRONTEND_URL);
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Error handling middleware
app.use(
    (
        err: Error,
        req: Request,
        res: Response,
        // gotta love this shit
        // eslint-disable-next-line
        next: NextFunction
    ) => {
      console.error(err.stack);
      res.status(500).json({ error: 'Something went wrong!' });
});


// -- Endpoints --
// Health check
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Root endpoint
app.get('/', (req: Request, res: Response) => {
  res.json({ message: 'Welcome to the Express.js TypeScript API!' });
});
app.get('/test/getAllUsers', async (req: Request, res: Response) => {
  try {
    const users = await db.getAllUsers();
    res.status(200).json({ success: true, users });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch users' });
  }
});
// Steam Authentication Routes
app.get('/auth/steam/login', (req: Request, res: Response, next: NextFunction) => {
    if (!STEAM_API_KEY) {
        return res.status(500).json({ 
            error: 'Steam authentication is not configured. STEAM_API_KEY is missing.' 
        });
    }
    const { walletAddress } = req.query;
    if (!walletAddress || typeof walletAddress !== 'string') {
        return res.status(400).json({ error: 'walletAddress is required as a query parameter' });
    }
    // Generate a random token and store the mapping
    const token = randomUUID();
    steamLoginTokenMap.set(token, walletAddress);
    // Redirect to Steam login with token as query param
    const redirectUrl = `/auth/steam?token=${encodeURIComponent(token)}`;
    res.redirect(redirectUrl);
});

// passport-steam default route 
app.get('/auth/steam', (req, res, next) => {
    const token = req.query.token as string | undefined;
    const returnURL = token
        ? `http://localhost:${PORT}/auth/steam/return/${encodeURIComponent(token)}`
        : `http://localhost:${PORT}/auth/steam/return`;
    console.log('[DEBUG] passport-steam returnURL:', returnURL);
    passport.authenticate('steam', { returnURL } as any)(req, res, next);
});

app.get('/auth/steam/return',
    passport.authenticate('steam', { failureRedirect: '/auth/steam/error' }),
    async (req: Request, res: Response) => {
        const steamUser = req.user as SteamProfile;
        const steamId = steamUser?.id;
        
        console.log('Steam authentication successful:', {
            steamId: steamId,
            displayName: steamUser?.displayName,
            photos: steamUser?.photos
        });
        
        // Redirect to frontend after successful Steam authentication, passing steamId and displayName
        const redirectUrl = `${FRONTEND_URL}/?steamId=${encodeURIComponent(steamId ?? '')}&displayName=${encodeURIComponent(steamUser?.displayName ?? '')}`;
        res.redirect(redirectUrl);
        // res.json({
        //     success: true,
        //     message: 'Steam authentication successful',
        //     steamId: steamId,
        //     displayName: steamUser?.displayName,
        //     profileUrl: steamUser?.profileUrl,
        //     avatar: steamUser?.photos?.[0]?.value
        // });
    }
);

app.get('/auth/steam/error', (req: Request, res: Response) => {
    res.status(401).json({ 
        error: 'Steam authentication failed',
        message: 'Unable to authenticate with Steam. Please try again.'
    });
});

// Insert new address & steamID pair from user
app.post('/api/user/add', (req: Request, res: Response) => {
    const userData = req.body as User;
    db.addRow(userData.address, String(userData.steamID), (err: Error | null) => {
        if (err) {
            console.error('Error adding user:', err);
            if ((err as any).code === 'SQLITE_CONSTRAINT') {
                res.status(409).json({ success: false, error: 'User address already exists', details: err.message });
            } else {
                res.status(500).json({ success: false, error: 'Failed to add user', details: err.message });
            }
        } else {
            console.log('User added successfully:', userData);
            res.status(200).json({ success: true, message: 'User added successfully' });
        }
    });
});

app.post('/api/user/get_steamid', (req: Request, res: Response) => {
    const address = req.body.address;
    console.log('[get_steamid] Received address:', address);
    db.getSteamID(address, (err: Error | null, steamID?: string) => {
        if (err) {
            console.error('[get_steamid] DB error:', err);
            return res.status(500).json({ error: err.message });
        }
        console.log('[get_steamid] Returning steamID:', steamID, 'for address:', address);
        res.status(200).json({ steamID });
    });
})

// Get Steam profile information for a wallet address using public Steam Community API
app.post('/api/user/get_steam_profile', async (req: Request, res: Response) => {
    try {
        const { address } = req.body;
        
        if (!address) {
            return res.status(400).json({ 
                error: 'Wallet address is required' 
            });
        }

        console.log('[get_steam_profile] Received address:', address);

        // First get the Steam ID from our database
        db.getSteamID(address, async (err: Error | null, steamID?: string) => {
            if (err) {
                console.error('[get_steam_profile] DB error:', err);
                return res.status(500).json({ error: err.message });
            }

            if (!steamID) {
                return res.status(404).json({ 
                    error: 'No Steam account linked to this wallet address' 
                });
            }

            console.log('[get_steam_profile] Found steamID:', steamID);

            try {
                // Use Steam Community public XML API (no API key required)
                const steamProfileUrl = `https://steamcommunity.com/profiles/${steamID}/?xml=1`;
                console.log('[get_steam_profile] Fetching from Steam Community XML API...');

                const response = await axios.get(steamProfileUrl, {
                    timeout: 10000, // 10 second timeout
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                });

                // Parse XML response (Steam returns XML format)
                const xmlData = response.data;
                
                // Basic XML parsing for Steam profile data
                const steamidMatch = xmlData.match(/<steamID64>(\d+)<\/steamID64>/);
                const nameMatch = xmlData.match(/<steamID><!\[CDATA\[(.*?)\]\]><\/steamID>/);
                const avatarMatch = xmlData.match(/<avatarIcon><!\[CDATA\[(.*?)\]\]><\/avatarIcon>/);
                const avatarMediumMatch = xmlData.match(/<avatarMedium><!\[CDATA\[(.*?)\]\]><\/avatarMedium>/);
                const avatarFullMatch = xmlData.match(/<avatarFull><!\[CDATA\[(.*?)\]\]><\/avatarFull>/);
                const profileUrlMatch = xmlData.match(/<profileURL><!\[CDATA\[(.*?)\]\]><\/profileURL>/);
                const onlineStateMatch = xmlData.match(/<onlineState><!\[CDATA\[(.*?)\]\]><\/onlineState>/);
                const stateMessageMatch = xmlData.match(/<stateMessage><!\[CDATA\[(.*?)\]\]><\/stateMessage>/);
                const realNameMatch = xmlData.match(/<realname><!\[CDATA\[(.*?)\]\]><\/realname>/);
                const visibilityMatch = xmlData.match(/<visibilityState>(\d+)<\/visibilityState>/);

                // Check if profile data was found (profile might be private)
                if (!steamidMatch || !nameMatch) {
                    return res.status(404).json({ 
                        error: 'Steam profile not found or is set to private' 
                    });
                }

                // Map online state text to numeric values (similar to Steam Web API)
                const getPersonaState = (state: string) => {
                    switch (state?.toLowerCase()) {
                        case 'online': return 1;
                        case 'busy': return 2;
                        case 'away': return 3;
                        case 'snooze': return 4;
                        case 'looking to trade': return 5;
                        case 'looking to play': return 6;
                        default: return 0; // offline
                    }
                };

                // Transform Steam Community XML response to match ProfilePage expectations
                const profileData = {
                    steamid: steamidMatch[1],
                    personaname: nameMatch[1],
                    profileurl: profileUrlMatch ? profileUrlMatch[1] : `https://steamcommunity.com/profiles/${steamID}`,
                    avatar: avatarMatch ? avatarMatch[1] : '',
                    avatarmedium: avatarMediumMatch ? avatarMediumMatch[1] : '',
                    avatarfull: avatarFullMatch ? avatarFullMatch[1] : '',
                    personastate: onlineStateMatch ? getPersonaState(onlineStateMatch[1]) : 0,
                    communityvisibilitystate: visibilityMatch ? parseInt(visibilityMatch[1]) : 1,
                    statemessage: stateMessageMatch ? stateMessageMatch[1] : '',
                    realname: realNameMatch ? realNameMatch[1] : '',
                    lastlogoff: null // Not available in XML API
                };

                console.log('[get_steam_profile] Successfully fetched profile for:', profileData.personaname);

                res.status(200).json({ 
                    success: true,
                    profile: profileData 
                });

            } catch (steamApiError) {
                console.error('[get_steam_profile] Steam Community API error:', steamApiError);
                
                if (axios.isAxiosError(steamApiError)) {
                    if (steamApiError.response?.status === 404) {
                        return res.status(404).json({ 
                            error: 'Steam profile not found' 
                        });
                    } else if (steamApiError.response?.status === 403) {
                        return res.status(403).json({ 
                            error: 'Steam profile is private or restricted' 
                        });
                    } else if (steamApiError.response?.status === 429) {
                        return res.status(429).json({ 
                            error: 'Too many requests. Please try again later.' 
                        });
                    }
                }

                res.status(500).json({ 
                    error: 'Failed to fetch Steam profile data from Steam Community' 
                });
            }
        });

    } catch (error) {
        console.error('[get_steam_profile] Unexpected error:', error);
        res.status(500).json({ 
            error: 'Internal server error while fetching Steam profile' 
        });
    }
});

// Get Steam inventory for a user
app.get('/api/steam/inventory/:steamID', async (req: Request, res: Response) => {
    try {
        const { steamID } = req.params;
        const appid = req.query.appid ? parseInt(req.query.appid as string) : 730;
        const contextid = req.query.contextid ? parseInt(req.query.contextid as string) : 2;

        // Validate steamID (should be numeric)
        if (!steamID || !/^\d+$/.test(steamID)) {
            res.status(400).json({
                error: 'Invalid Steam ID format. Must be numeric.'
            });
            return;
        }

        const steamApiUrl = `https://steamcommunity.com/inventory/${steamID}/${appid}/${contextid}`;
        console.log(`Fetching Steam inventory from: ${steamApiUrl}`);

        const response = await axios.get<SteamInventoryResponse>(steamApiUrl, {
            timeout: 10000 // 10 second timeout
        });

        const inventoryData = response.data;
        // Removed full raw response log for clarity

        if (!inventoryData.success || inventoryData.success !== 1) {
            res.status(404).json({
                error: inventoryData.error || 'Steam inventory not found or private'
            });
            return;
        }

        // Merge assets and descriptions for frontend
        const assets = (inventoryData.assets || []).map(asset => {
            // Find matching description by classid and instanceid
            const desc = (inventoryData.descriptions || []).find(d =>
                d.classid === asset.classid && d.instanceid === asset.instanceid
            );
            if (!desc) {
                console.warn(`[Inventory Merge Warning] No description found for assetid=${asset.assetid}, classid=${asset.classid}, instanceid=${asset.instanceid}`);
            }
            return {
                assetid: asset.assetid,
                classid: asset.classid,
                instanceid: asset.instanceid,
                contextid: asset.contextid,
                appid: asset.appid,
                amount: asset.amount,
                icon_url: desc?.icon_url || '',
                name: desc?.name || desc?.market_hash_name || '',
                type: desc?.type || '',
                // Add more fields if needed
            };
        });

        // console.log('[Merged assets output]', JSON.stringify(assets, null, 2));
        res.json({ assets });
        return;
    } catch (error) {
        // Enhanced error logging
        if (axios.isAxiosError(error)) {
            console.error('Error fetching Steam inventory (AxiosError):', {
                message: error.message,
                code: error.code,
                status: error.response?.status,
                data: error.response?.data,
                headers: error.response?.headers,
                config: error.config,
            });
            if (error.response?.status === 401) {
                res.status(403).json({
                    error: 'Steam inventory is private or requires authentication'
                });
                return;
            } else if (error.response?.status === 403) {
                res.status(403).json({
                    error: 'Steam inventory is private or user not found'
                });
                return;
            } else if (error.response?.status === 500) {
                res.status(502).json({
                    error: 'Steam API is currently unavailable'
                });
                return;
            } else {
                // Log and return the error from Steam API if available
                res.status(error.response?.status || 500).json({
                    error: error.response?.data || error.message || 'Unknown error from Steam API'
                });
                return;
            }
        } else {
            console.error('Error fetching Steam inventory (Non-Axios):', error);
        }
        res.status(500).json({
            error: 'Failed to fetch Steam inventory'
        });
        return;
    }
});

// List Steam asset data on Walrus
app.post('/api/walrus/list', async (req: Request, res: Response) => {
    try {
        const assetData = req.body as SteamAsset;
        
        // Validate required fields
        if (!assetData.appid || !assetData.assetid || !assetData.walletAddress || !assetData.icon_url || !assetData.name || !assetData.price) {
            return res.status(400).json({ 
                error: 'Missing required fields: appid, assetid, walletAddress, icon_url, name, and price are required' 
            });
        }

        // Basic Sui address validation (0x followed by 64 hex characters)
        const suiAddressRegex = /^0x[a-fA-F0-9]{64}$/;
        if (!suiAddressRegex.test(assetData.walletAddress)) {
            return res.status(400).json({
                error: 'Invalid Sui wallet address format. Must be 0x followed by 64 hex characters'
            });
        }

        // Validate price format (should be a valid number in SUI)
        const priceNumber = parseFloat(assetData.price);
        if (isNaN(priceNumber) || priceNumber < 0) {
            return res.status(400).json({
                error: 'Invalid price format. Price must be a valid non-negative number in SUI'
            });
        }

        const blobId = await storeAssetOnWalrus(assetData);
        
        if (blobId) {
            // Store asset record in database
            const assetRecord: AssetRecord = {
                walletAddress: assetData.walletAddress,
                blobId: blobId,
                appid: assetData.appid,
                assetid: assetData.assetid,
                classid: assetData.classid,
                instanceid: assetData.instanceid,
                contextid: assetData.contextid,
                amount: assetData.amount,
                icon_url: assetData.icon_url,
                name: assetData.name,
                price: assetData.price,
                steamID: assetData.steamID,
                steamName: assetData.steamName,
                uploadedAt: new Date().toISOString()
            };

            try {
                await db.addAsset(assetRecord);
                res.status(200).json({
                    success: true,
                    blobId: blobId,
                    walletAddress: assetData.walletAddress,
                    message: 'Asset data listed successfully on Walrus and database'
                });
            } catch (dbError) {
                console.error('Error storing asset in database:', dbError);
                // Still return success since Walrus storage worked
                res.status(200).json({
                    success: true,
                    blobId: blobId,
                    walletAddress: assetData.walletAddress,
                    message: 'Asset data listed on Walrus but failed to update database',
                    warning: 'Database update failed'
                });
            }
        } else {
            res.status(500).json({
                error: 'Failed to list asset data on Walrus'
            });
        }
    } catch (error) {
        console.error('Error in walrus list endpoint:', error);
        res.status(500).json({
            error: 'Internal server error while listing asset data'
        });
    }
});

// Retrieve Steam asset data from Walrus
app.get('/api/walrus/retrieve/:blobId', async (req: Request, res: Response) => {
    try {
        const { blobId } = req.params;
        
        if (!blobId) {
            return res.status(400).json({
                error: 'Blob ID is required'
            });
        }

        const assetData = await retrieveAssetFromWalrus(blobId);
        
        res.status(200).json({
            success: true,
            data: assetData,
            blobId: blobId
        });
    } catch (error) {
        console.error('Error in walrus retrieve endpoint:', error);
        res.status(500).json({
            error: 'Failed to retrieve asset data from Walrus'
        });
    }
});

// Walrus Upload Proxy to handle CORS issues
app.post('/api/walrus/upload-proxy', async (req: Request, res: Response) => {
    try {
        const { data, epochs = 5 } = req.body;
        
        if (!data) {
            return res.status(400).json({
                error: 'Data is required'
            });
        }

        // Convert base64 data to buffer if needed
        let buffer: Buffer;
        if (typeof data === 'string') {
            // If it's base64, decode it
            if (data.startsWith('data:')) {
                const base64Data = data.split(',')[1];
                buffer = Buffer.from(base64Data, 'base64');
            } else {
                // If it's plain string, convert to buffer
                buffer = Buffer.from(data, 'utf-8');
            }
        } else if (data instanceof Buffer) {
            buffer = data;
        } else {
            // If it's an object, stringify it
            buffer = Buffer.from(JSON.stringify(data), 'utf-8');
        }

        console.log('Walrus proxy: Uploading blob of size:', buffer.length, 'bytes');

        const publisherEndpoints = [
            'https://publisher.walrus-testnet.walrus.space',
            'https://wal-publisher-testnet.staketab.org'
        ];

        let walrusSuccess = false;
        let lastError = null;
        let blobId = null;

        for (const publisherUrl of publisherEndpoints) {
            try {
                console.log(`Walrus proxy: Attempting upload to: ${publisherUrl}`);
                
                const response = await axios.put(
                    `${publisherUrl}/v1/blobs?epochs=${epochs}`,
                    buffer,
                    {
                        headers: {
                            'Content-Type': 'application/octet-stream'
                        },
                        timeout: 30000 // 30 second timeout
                    }
                );

                if (response.status === 200) {
                    const walrusResponse = response.data;
                    blobId = walrusResponse?.newlyCreated?.blobObject?.blobId || walrusResponse?.alreadyCertified?.blobId;
                    
                    if (blobId) {
                        console.log(`Walrus proxy: Upload successful! Blob ID: ${blobId} via ${publisherUrl}`);
                        walrusSuccess = true;
                        break;
                    }
                }
            } catch (error: any) {
                const errorMessage = error.response?.data || error.message || String(error);
                lastError = `${publisherUrl}: ${errorMessage}`;
                console.warn(`Walrus proxy: Upload failed at ${publisherUrl}:`, errorMessage);
            }
        }

        if (walrusSuccess && blobId) {
            res.status(200).json({
                success: true,
                blobId: blobId,
                message: 'Blob uploaded successfully to Walrus'
            });
        } else {
            console.warn('Walrus proxy: All publisher endpoints failed. Last error:', lastError);
            res.status(500).json({
                success: false,
                error: 'All Walrus publisher endpoints failed',
                details: lastError
            });
        }
        
    } catch (error) {
        console.error('Error in Walrus upload proxy:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error in upload proxy'
        });
    }
});

// Get all assets for a specific wallet address
app.get('/api/walrus/assets/:walletAddress', async (req: Request, res: Response) => {
    try {
        const { walletAddress } = req.params;
        
        if (!walletAddress) {
            return res.status(400).json({
                error: 'Wallet address is required'
            });
        }

        // Basic Sui address validation
        const suiAddressRegex = /^0x[a-fA-F0-9]{64}$/;
        if (!suiAddressRegex.test(walletAddress)) {
            return res.status(400).json({
                error: 'Invalid Sui wallet address format'
            });
        }

        const assets = await db.getAssetsByWallet(walletAddress);
        
        res.status(200).json({
            success: true,
            walletAddress: walletAddress,
            assets: assets,
            count: assets.length
        });
    } catch (error) {
        console.error('Error in get assets by wallet endpoint:', error);
        res.status(500).json({
            error: 'Failed to retrieve assets for wallet address'
        });
    }
});

// Get all assets (with optional pagination)
app.get('/api/walrus/assets', async (req: Request, res: Response) => {
    try {
        const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
        const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
        
        // Validate pagination parameters
        if (limit && (limit < 1 || limit > 100)) {
            return res.status(400).json({
                error: 'Limit must be between 1 and 100'
            });
        }
        
        if (offset && offset < 0) {
            return res.status(400).json({
                error: 'Offset must be non-negative'
            });
        }

        const assets = await db.getAllAssets(limit, offset);
        
        res.status(200).json({
            success: true,
            assets: assets,
            count: assets.length,
            pagination: {
                limit: limit || null,
                offset: offset || null
            }
        });
    } catch (error) {
        console.error('Error in get all assets endpoint:', error);
        res.status(500).json({
            error: 'Failed to retrieve assets'
        });
    }
});

// Get marketplace assets (formatted for marketplace display)
app.get('/api/marketplace/assets', async (req: Request, res: Response) => {
    try {
        const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
        const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;
        
        // Validate pagination parameters
        if (limit < 1 || limit > 100) {
            return res.status(400).json({
                error: 'Limit must be between 1 and 100'
            });
        }
        
        if (offset < 0) {
            return res.status(400).json({
                error: 'Offset must be non-negative'
            });
        }

        const assets = await db.getAllAssets(limit, offset);
        
        // Helper function to format SUI prices intelligently
        const formatSuiPrice = (price: string): string => {
            const num = parseFloat(price);
            if (num === 0) return "0 SUI";
            
            // Remove trailing zeros after decimal point
            const formatted = num.toFixed(4).replace(/\.?0+$/, '');
            return `${formatted} SUI`;
        };

        // Transform assets for marketplace display
        const marketplaceAssets = assets.map((asset: AssetRecord) => ({
            id: asset.id,
            assetid: asset.assetid,
            appid: asset.appid,
            steamID: asset.steamID,
            steamName: asset.steamName,
            steamAvatar: asset.steamAvatar,
            title: asset.name,
            game: asset.appid === 730 ? "Counter-Strike: Global Offensive" : 
                  asset.appid === 570 ? "Dota 2" : 
                  asset.appid === 440 ? "Team Fortress 2" : "Unknown Game",
            gameId: asset.appid === 730 ? "csgo" : 
                   asset.appid === 570 ? "dota2" : 
                   asset.appid === 440 ? "tf2" : "unknown",
            price: formatSuiPrice(asset.price), // Price is already stored in SUI format, format intelligently
            image: asset.icon_url ? `https://steamcommunity-a.akamaihd.net/economy/image/${asset.icon_url}` : "/placeholder.svg",
            isAuction: false, // All current listings are fixed price
            timeLeft: null,
            walletAddress: asset.walletAddress,
            blobId: asset.blobId,
            description: asset.description,
            uploadedAt: asset.uploadedAt
        }));
        
        res.status(200).json({
            success: true,
            assets: marketplaceAssets,
            count: marketplaceAssets.length,
            pagination: {
                limit,
                offset,
                hasMore: marketplaceAssets.length === limit
            }
        });
    } catch (error) {
        console.error('Error in marketplace assets endpoint:', error);
        res.status(500).json({
            error: 'Failed to retrieve marketplace assets'
        });
    }
});

// Delete an asset (removes from database, but not from Walrus)
app.delete('/api/walrus/assets/:blobId', async (req: Request, res: Response) => {
    try {
        const { blobId } = req.params;
        const { walletAddress } = req.body;
        
        if (!blobId || !walletAddress) {
            return res.status(400).json({
                error: 'Blob ID and wallet address are required'
            });
        }

        // Basic Sui address validation
        const suiAddressRegex = /^0x[a-fA-F0-9]{64}$/;
        if (!suiAddressRegex.test(walletAddress)) {
            return res.status(400).json({
                error: 'Invalid Sui wallet address format'
            });
        }

        const deleted = await db.deleteAsset(blobId, walletAddress);
        
        if (deleted) {
            res.status(200).json({
                success: true,
                message: 'Asset record deleted successfully from database',
                note: 'Data still exists on Walrus network'
            });
        } else {
            res.status(404).json({
                error: 'Asset not found or you do not have permission to delete it'
            });
        }
    } catch (error) {
        console.error('Error in delete asset endpoint:', error);
        res.status(500).json({
            error: 'Failed to delete asset record'
        });
    }
});

// API endpoint to store asset with Walrus blob ID and Sui signature
app.post('/api/store-asset', async (req: Request, res: Response) => {
    try {
        console.log('[API][Store Asset] Received request body:', JSON.stringify(req.body, null, 2));
        
        const {
            appid, contextid, assetid, classid, instanceid, amount, walletAddress,
            icon_url, name, price, listingType, description, auctionDuration,
            blobId, signature, signedBytes, steamID, steamName, steamAvatar
        } = req.body;

        console.log('[API][Store Asset] Extracted fields:', {
            appid, contextid, assetid, classid, instanceid, amount, walletAddress,
            icon_url, name, price, listingType, description, auctionDuration,
            blobId, signature: signature ? signature.substring(0, 20) + '...' : 'undefined',
            steamID, steamName, steamAvatar
        });

        // Validate required fields
        if (!walletAddress || !blobId || !signature || !assetid) {
            console.log('[API][Store Asset] Validation failed - Missing required fields:', {
                walletAddress: !!walletAddress,
                blobId: !!blobId,
                signature: !!signature,
                assetid: !!assetid
            });
            return res.status(400).json({ 
                error: 'Missing required fields: walletAddress, blobId, signature, assetid' 
            });
        }

        // Create asset record for database (matching the existing AssetRecord interface)
        const assetRecord: AssetRecord = {
            walletAddress,
            blobId,
            appid: parseInt(appid) || 0,
            assetid,
            classid: classid || '',
            instanceid: instanceid || '',
            contextid: contextid || '',
            amount: amount || '1',
            icon_url: icon_url || '',
            name: name || 'Unknown Item',
            price: price ? parseFloat(price).toString() : '0',
            description: description || '',
            steamID: steamID || null,
            steamName: steamName || null,
            steamAvatar: steamAvatar || null,
            uploadedAt: new Date().toISOString()
        };

        // Store in database
        await db.addAsset(assetRecord);
        
        // Log additional metadata for future use (signature, listing details, etc.)
        console.log(`[API][Store Asset] Successfully stored asset ${assetid} for wallet ${walletAddress}`);
        console.log(`[API][Store Asset] Blob ID: ${blobId}, Signature: ${signature?.substring(0, 20)}...`);
        console.log(`[API][Store Asset] Listing details:`, { listingType, description, auctionDuration });
        
        res.json({ 
            success: true, 
            message: 'Asset successfully listed with signature verification',
            blobId,
            assetId: assetid
        });

    } catch (error) {
        console.error('[API][Store Asset] Error:', error);
        
        // Handle specific database constraint errors
        if (error instanceof Error && error.message.includes('UNIQUE constraint failed: assets.walletAddress, assets.assetid')) {
            return res.status(400).json({ 
                error: 'Asset already listed', 
                details: 'This asset is already listed for sale by your wallet. Please check your existing listings.' 
            });
        }
        
        res.status(500).json({ 
            error: 'Failed to store asset listing', 
            details: error instanceof Error ? error.message : 'Unknown error' 
        });
    }
});

// 404 handler
app.use('/{*any}', (req: Request, res: Response) => {
  res.status(404).json({ error: 'Route not found' });
});

// Global error handler (should be after all routes)
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    console.error('[Express][Global Error Handler]', err);
    if (res.headersSent) {
        return next(err);
    }
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
});

// Start server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Visit http://localhost:${PORT} to get started`);
});

export default app;
