import { SuiClient } from "@mysten/sui/client";
import { SuiEvent } from "@mysten/sui/client";

// Escrow package configuration
export const ESCROW_PACKAGE_ID = process.env.ESCROW_PACKAGE_ID || "0x48d4ccd81159212812ac85b3dbf5359a3170c0254888d4a65e07f0e5af4cb667";
const SUI_TESTNET_URL = "https://fullnode.testnet.sui.io";

// Log the package ID being used
console.log(`Using ESCROW_PACKAGE_ID: ${ESCROW_PACKAGE_ID}`);

// Initialize Sui client
const suiClient = new SuiClient({ url: SUI_TESTNET_URL });

// Interface for escrow events
export interface EscrowInitializedEvent {
  escrow_id: string;
  buyer: string;
  seller: string;
  asset_id: string;
  price: string;
}

export interface PaymentDepositedEvent {
  escrow_id: string;
  buyer: string;
  amount: string;
}

export interface EscrowStatusUpdate {
  escrow_id: string;
  buyer: string;
  seller: string;
  asset_id: string;
  price: string;
  status: 'initialized' | 'deposited' | 'completed' | 'cancelled';
  steam_trade_completed?: boolean;
  transaction_digest?: string;
}

// Listen for escrow events and update database
export class EscrowEventListener {
  private isListening = false;
  private eventCallbacks: ((event: EscrowStatusUpdate) => void)[] = [];

  constructor() {}

  // Add callback for escrow status updates
  onEscrowStatusUpdate(callback: (event: EscrowStatusUpdate) => void) {
    this.eventCallbacks.push(callback);
  }

  // Start listening for escrow events
  async startListening() {
    if (this.isListening) return;
    
    this.isListening = true;
    console.log("Started listening for escrow events...");

    try {
      // Listen for EscrowInitialized events
      await this.subscribeToEvents("EscrowInitialized", this.handleEscrowInitialized.bind(this));
      
      // Listen for PaymentDeposited events
      await this.subscribeToEvents("PaymentDeposited", this.handlePaymentDeposited.bind(this));
      
      // Listen for PaymentClaimed events
      await this.subscribeToEvents("PaymentClaimed", this.handlePaymentClaimed.bind(this));
      
      // Listen for EscrowCancelled events
      await this.subscribeToEvents("EscrowCancelled", this.handleEscrowCancelled.bind(this));
      
    } catch (error) {
      console.error("Error starting escrow event listener:", error);
      this.isListening = false;
    }
  }

  // Subscribe to specific event types
  private async subscribeToEvents(eventType: string, handler: (event: any) => void) {
    // Note: In production, you'd use WebSocket subscriptions or polling
    // For now, we'll use periodic polling as an example
    setInterval(async () => {
      try {
        await this.pollForEvents(eventType, handler);
      } catch (error) {
        console.error(`Error polling for ${eventType} events:`, error);
      }
    }, 10000); // Poll every 10 seconds
  }

  // Poll for events (in production, use WebSocket subscriptions)
  private async pollForEvents(eventType: string, handler: (event: any) => void) {
    try {
      console.log(`Polling for ${eventType} events with package ID: ${ESCROW_PACKAGE_ID}`);
      
      const events = await suiClient.queryEvents({
        query: {
          MoveEventType: `${ESCROW_PACKAGE_ID}::steam_escrow::${eventType}`,
        },
        order: "descending",
        limit: 50,
      });

      if (events.data.length > 0) {
        console.log(`Found ${events.data.length} ${eventType} events`);
        for (const event of events.data) {
          handler(event);
        }
      }
    } catch (error: any) {
      // Handle specific errors gracefully
      if (error?.message?.includes("Invalid params") || error?.code === -32602) {
        console.warn(`Event type ${eventType} may not exist yet or package ID is incorrect:`, error.message);
      } else if (error?.message?.includes("not found")) {
        // Events might not exist yet, which is normal for new packages
        console.log(`No ${eventType} events found yet (this is normal for new deployments)`);
      } else {
        console.error(`Error querying ${eventType} events:`, error);
      }
    }
  }

  // Handle EscrowInitialized events
  private handleEscrowInitialized(event: SuiEvent) {
    try {
      const parsedData = event.parsedJson as EscrowInitializedEvent;
      
      const statusUpdate: EscrowStatusUpdate = {
        escrow_id: parsedData.escrow_id,
        buyer: parsedData.buyer,
        seller: parsedData.seller,
        asset_id: parsedData.asset_id,
        price: parsedData.price,
        status: 'initialized',
        transaction_digest: event.id.txDigest,
      };

      this.notifyCallbacks(statusUpdate);
      console.log("Escrow initialized:", statusUpdate);
    } catch (error) {
      console.error("Error handling EscrowInitialized event:", error);
    }
  }

  // Handle PaymentDeposited events
  private handlePaymentDeposited(event: SuiEvent) {
    try {
      const parsedData = event.parsedJson as PaymentDepositedEvent;
      
      const statusUpdate: EscrowStatusUpdate = {
        escrow_id: parsedData.escrow_id,
        buyer: parsedData.buyer,
        seller: '', // Will be filled from database
        asset_id: '', // Will be filled from database
        price: parsedData.amount,
        status: 'deposited',
        transaction_digest: event.id.txDigest,
      };

      this.notifyCallbacks(statusUpdate);
      console.log("Payment deposited:", statusUpdate);
    } catch (error) {
      console.error("Error handling PaymentDeposited event:", error);
    }
  }

  // Handle PaymentClaimed events
  private handlePaymentClaimed(event: SuiEvent) {
    try {
      const parsedData = event.parsedJson as any;
      
      const statusUpdate: EscrowStatusUpdate = {
        escrow_id: parsedData.escrow_id,
        buyer: '', // Will be filled from database
        seller: parsedData.seller,
        asset_id: '', // Will be filled from database
        price: parsedData.amount,
        status: 'completed',
        steam_trade_completed: true,
        transaction_digest: event.id.txDigest,
      };

      this.notifyCallbacks(statusUpdate);
      console.log("Payment claimed (trade completed):", statusUpdate);
    } catch (error) {
      console.error("Error handling PaymentClaimed event:", error);
    }
  }

  // Handle EscrowCancelled events
  private handleEscrowCancelled(event: SuiEvent) {
    try {
      const parsedData = event.parsedJson as any;
      
      const statusUpdate: EscrowStatusUpdate = {
        escrow_id: parsedData.escrow_id,
        buyer: parsedData.buyer,
        seller: '', // Will be filled from database
        asset_id: '', // Will be filled from database
        price: parsedData.refund_amount,
        status: 'cancelled',
        steam_trade_completed: false,
        transaction_digest: event.id.txDigest,
      };

      this.notifyCallbacks(statusUpdate);
      console.log("Escrow cancelled:", statusUpdate);
    } catch (error) {
      console.error("Error handling EscrowCancelled event:", error);
    }
  }

  // Notify all registered callbacks
  private notifyCallbacks(statusUpdate: EscrowStatusUpdate) {
    this.eventCallbacks.forEach(callback => {
      try {
        callback(statusUpdate);
      } catch (error) {
        console.error("Error in escrow status callback:", error);
      }
    });
  }

  // Stop listening
  stopListening() {
    this.isListening = false;
    console.log("Stopped listening for escrow events");
  }
}

// Steam inventory checking utilities
export class SteamInventoryChecker {
  private steamApiKey: string;

  constructor(steamApiKey: string) {
    this.steamApiKey = steamApiKey;
  }

  // Check if a user still has a specific asset in their inventory
  async checkAssetInInventory(steamId: string, appId: string, assetId: string): Promise<boolean> {
    try {
      const url = `https://api.steampowered.com/IEconService/GetInventory/v1/`;
      const response = await fetch(`${url}?key=${this.steamApiKey}&steamid=${steamId}&appid=${appId}&count=5000`);
      
      if (!response.ok) {
        throw new Error(`Steam API error: ${response.status}`);
      }

      const data = await response.json();
      
      if (!data.response?.assets) {
        return false;
      }

      // Check if the specific asset exists in the inventory
      const assetExists = data.response.assets.some((asset: any) => asset.assetid === assetId);
      return assetExists;
    } catch (error) {
      console.error("Error checking Steam inventory:", error);
      throw error;
    }
  }

  // Get item count for a specific asset type
  async getItemCount(steamId: string, appId: string, classId: string, instanceId: string): Promise<number> {
    try {
      const url = `https://api.steampowered.com/IEconService/GetInventory/v1/`;
      const response = await fetch(`${url}?key=${this.steamApiKey}&steamid=${steamId}&appid=${appId}&count=5000`);
      
      if (!response.ok) {
        throw new Error(`Steam API error: ${response.status}`);
      }

      const data = await response.json();
      
      if (!data.response?.assets) {
        return 0;
      }

      // Count items matching the class and instance ID
      const matchingItems = data.response.assets.filter((asset: any) => 
        asset.classid === classId && asset.instanceid === instanceId
      );
      
      return matchingItems.length;
    } catch (error) {
      console.error("Error getting item count:", error);
      throw error;
    }
  }
}

// Export singleton instances
export const escrowEventListener = new EscrowEventListener();
export const createSteamInventoryChecker = (steamApiKey: string) => new SteamInventoryChecker(steamApiKey);
