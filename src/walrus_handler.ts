import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const PUBLISHER = process.env.PUBLISHER!;
const AGGREGATOR = process.env.AGGREGATOR!;

export interface SteamAsset {
    appid: number;
    contextid: string;
    assetid: string;
    classid: string;
    instanceid: string;
    amount: string;
    walletAddress: string; // Sui wallet address of the asset owner
    icon_url: string; // Steam asset icon URL
    name: string; // Steam asset name
    price: string; // Price in MIST (smallest Sui denomination)
    steamID?: string; // Steam user ID
    steamName?: string; // Steam display name
}

// Walrus storage response interface
export interface WalrusStoreResponse {
    newlyCreated?: {
        blobObject?: {
            blobId: string;
        };
    };
    alreadyCertified?: {
        blobId: string;
    };
}

/**
 * Store Steam asset data on Walrus
 * @param assetData - The Steam asset data to store
 * @returns Promise<string | undefined> - The blob ID if successful
 */
export async function storeAssetOnWalrus(assetData: SteamAsset): Promise<string | undefined> {
    try {
        const jsonContent = JSON.stringify(assetData);
        const response = await axios.put(
            `${PUBLISHER}/v1/blobs?epochs=1`,
            jsonContent,
            { 
                headers: { 
                    'Content-Type': 'application/json' 
                } 
            }
        );

        console.log('Walrus store response:', response.data);
        
        const walrusResponse = response.data as WalrusStoreResponse;
        
        // Return blob ID from either newly created or already certified response
        return walrusResponse.newlyCreated?.blobObject?.blobId || 
               walrusResponse.alreadyCertified?.blobId;
    } catch (error) {
        console.error('Error storing asset on Walrus:', error);
        throw error;
    }
}

/**
 * Retrieve Steam asset data from Walrus
 * @param blobId - The blob ID to retrieve
 * @returns Promise<SteamAsset> - The retrieved Steam asset data
 */
export async function retrieveAssetFromWalrus(blobId: string): Promise<SteamAsset> {
    try {
        const response = await axios.get(
            `${AGGREGATOR}/v1/blobs/${blobId}`,
            {
                headers: {
                    'Accept': 'application/json'
                }
            }
        );

        console.log('Walrus retrieve response for blob:', blobId);
        
        // Parse and validate the response data
        const assetData = response.data as SteamAsset;
        
        // Basic validation to ensure we got the expected structure
        if (!assetData.appid || !assetData.assetid || !assetData.walletAddress || !assetData.icon_url || !assetData.name || !assetData.price) {
            throw new Error('Invalid asset data structure retrieved from Walrus');
        }
        
        return assetData;
    } catch (error) {
        console.error('Error retrieving asset from Walrus:', error);
        throw error;
    }
}
