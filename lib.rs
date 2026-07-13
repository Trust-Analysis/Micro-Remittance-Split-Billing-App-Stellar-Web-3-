#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, 
    token, Address, Env, 
    symbol_short, 
    xdr::ScVal,
    unwrap::UnwrapOptimized
};

// Define the structure of a Split Bill with enhanced fields
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SplitBill {
    pub payee: Address,
    pub token: Address,
    pub total_amount: i128,
    pub amount_collected: i128,
    pub is_active: bool,
    pub created_at: u64,
    pub participant_count: u32,
}

// Event topics for backend indexing
#[contracttype]
pub enum EventTopic {
    BillCreated,
    BillPaid,
    BillCompleted,
}

// Reentrancy guard key
#[contracttype]
pub enum ReentrancyKey {
    InProgress,
}

// Keys for our contract state storage
#[contracttype]
pub enum DataKey {
    Bill(u32),
    BillCount,
    Admin,
}

// Constants for storage management
const BUMP_INSTANCE_LEDGER_THRESHOLD: u32 = 10_000;
const BUMP_INSTANCE_LEDGER_BUMP: u32 = 10_000;
const BUMP_PERSISTENT_LEDGER_THRESHOLD: u32 = 20_000;
const BUMP_PERSISTENT_LEDGER_BUMP: u32 = 20_000;

// Minimum and maximum constraints
const MIN_AMOUNT: i128 = 1; // 1 stroop minimum
const MAX_TOTAL_AMOUNT: i128 = 10_000_000_000_000_000; // 10M XLM max
const MAX_BILL_ID: u32 = 1_000_000;

#[contract]
pub struct SplitBillContract;

#[contractimpl]
impl SplitBillContract {
    /// Initialize the contract with an admin address
    pub fn initialize(env: Env, admin: Address) {
        // Check if already initialized
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Contract already initialized");
        }
        
        admin.require_auth();
        
        // Set admin with persistent storage for long-term access
        env.storage().persistent().set(&DataKey::Admin, &admin);
        env.storage().persistent().bump(
            &DataKey::Admin,
            BUMP_PERSISTENT_LEDGER_THRESHOLD,
            BUMP_PERSISTENT_LEDGER_BUMP,
        );
    }

    /// Micro-remittance: A direct peer-to-peer payment wrapper with enhanced validation
    pub fn remit(env: Env, from: Address, to: Address, token: Address, amount: i128) {
        // Validate amount
        Self::validate_amount(amount);
        
        from.require_auth();
        
        let client = token::Client::new(&env, &token);
        client.transfer(&from, &to, &amount);
        
        // Emit event for tracking
        env.events().publish(
            (symbol_short!("remit"), from.clone()),
            (to, amount),
        );
    }

    /// Creates a new split bill and returns the unique Bill ID with enhanced validation
    pub fn create_bill(env: Env, payee: Address, token: Address, total_amount: i128) -> u32 {
        // Validate total amount
        Self::validate_total_amount(total_amount);
        
        payee.require_auth();
        
        // Reentrancy protection
        Self::check_reentrancy(&env);
        env.storage().instance().set(&ReentrancyKey::InProgress, &true);
        
        // Fetch current bill count with overflow protection
        let mut count: u32 = env.storage()
            .instance()
            .get(&DataKey::BillCount)
            .unwrap_or(0);
        
        // Prevent bill ID overflow
        if count >= MAX_BILL_ID {
            panic!("Maximum bill ID reached");
        }
        
        count = count.checked_add(1).expect("Bill ID overflow");
        
        let bill = SplitBill {
            payee: payee.clone(),
            token,
            total_amount,
            amount_collected: 0,
            is_active: true,
            created_at: env.ledger().sequence(),
            participant_count: 0,
        };
        
        // Store the bill with proper storage management
        let bill_key = DataKey::Bill(count);
        env.storage().instance().set(&bill_key, &bill);
        env.storage().instance().bump(
            &bill_key,
            BUMP_INSTANCE_LEDGER_THRESHOLD,
            BUMP_INSTANCE_LEDGER_BUMP,
        );
        
        // Update the count with storage bump
        env.storage().instance().set(&DataKey::BillCount, &count);
        env.storage().instance().bump(
            &DataKey::BillCount,
            BUMP_INSTANCE_LEDGER_THRESHOLD,
            BUMP_INSTANCE_LEDGER_BUMP,
        );
        
        // Clear reentrancy guard
        env.storage().instance().set(&ReentrancyKey::InProgress, &false);
        
        // Emit event for backend indexing
        env.events().publish(
            (symbol_short!("bill_created"), count),
            (payee, total_amount),
        );
        
        count
    }

    /// Allows a participant to pay their portion of the bill with enhanced security
    pub fn pay_bill(env: Env, payer: Address, bill_id: u32, amount: i128) {
        // Validate amount
        Self::validate_amount(amount);
        
        payer.require_auth();
        
        // Reentrancy protection
        Self::check_reentrancy(&env);
        env.storage().instance().set(&ReentrancyKey::InProgress, &true);
        
        let bill_key = DataKey::Bill(bill_id);
        let mut bill: SplitBill = env.storage()
            .instance()
            .get(&bill_key)
            .expect("Bill not found");
        
        // Validate bill state
        if !bill.is_active {
            panic!("Bill is already fully paid or inactive");
        }
        
        // Check if payment would exceed total amount
        let new_collected = bill.amount_collected.checked_add(amount)
            .expect("Amount overflow");
        
        if new_collected > bill.total_amount {
            panic!("Payment would exceed total bill amount");
        }
        
        // Transfer the split portion from the payer to the payee
        let client = token::Client::new(&env, &bill.token);
        client.transfer(&payer, &bill.payee, &amount);
        
        // Update the collected amount with overflow protection
        bill.amount_collected = new_collected;
        bill.participant_count = bill.participant_count.checked_add(1)
            .expect("Participant count overflow");
        
        // Check if bill is completed
        let was_completed = bill.amount_collected >= bill.total_amount;
        if was_completed {
            bill.is_active = false;
        }
        
        // Save the updated bill state with storage bump
        env.storage().instance().set(&bill_key, &bill);
        env.storage().instance().bump(
            &bill_key,
            BUMP_INSTANCE_LEDGER_THRESHOLD,
            BUMP_INSTANCE_LEDGER_BUMP,
        );
        
        // Clear reentrancy guard
        env.storage().instance().set(&ReentrancyKey::InProgress, &false);
        
        // Emit appropriate event
        if was_completed {
            env.events().publish(
                (symbol_short!("bill_completed"), bill_id),
                (bill.amount_collected, bill.participant_count),
            );
        } else {
            env.events().publish(
                (symbol_short!("bill_paid"), bill_id),
                (payer, amount),
            );
        }
    }

    /// Query the status of a bill with storage bump
    pub fn get_bill(env: Env, bill_id: u32) -> SplitBill {
        let bill_key = DataKey::Bill(bill_id);
        let bill: SplitBill = env.storage()
            .instance()
            .get(&bill_key)
            .expect("Bill not found");
        
        // Bump storage to extend lifetime
        env.storage().instance().bump(
            &bill_key,
            BUMP_INSTANCE_LEDGER_THRESHOLD,
            BUMP_INSTANCE_LEDGER_BUMP,
        );
        
        bill
    }

    /// Get the total number of bills created
    pub fn get_bill_count(env: Env) -> u32 {
        let count = env.storage()
            .instance()
            .get(&DataKey::BillCount)
            .unwrap_or(0);
        
        // Bump storage
        env.storage().instance().bump(
            &DataKey::BillCount,
            BUMP_INSTANCE_LEDGER_THRESHOLD,
            BUMP_INSTANCE_LEDGER_BUMP,
        );
        
        count
    }

    /// Admin function to close a bill (emergency stop)
    pub fn close_bill(env: Env, admin: Address, bill_id: u32) {
        // Verify admin authorization
        let stored_admin: Address = env.storage()
            .persistent()
            .get(&DataKey::Admin)
            .expect("Contract not initialized");
        
        if admin != stored_admin {
            panic!("Unauthorized: not admin");
        }
        
        admin.require_auth();
        
        let bill_key = DataKey::Bill(bill_id);
        let mut bill: SplitBill = env.storage()
            .instance()
            .get(&bill_key)
            .expect("Bill not found");
        
        bill.is_active = false;
        
        env.storage().instance().set(&bill_key, &bill);
        env.storage().instance().bump(
            &bill_key,
            BUMP_INSTANCE_LEDGER_THRESHOLD,
            BUMP_INSTANCE_LEDGER_BUMP,
        );
        
        env.events().publish(
            (symbol_short!("bill_closed"), bill_id),
            admin,
        );
    }

    // Helper function to check reentrancy
    fn check_reentrancy(env: &Env) {
        if env.storage().instance().get(&ReentrancyKey::InProgress).unwrap_or(false) {
            panic!("Reentrancy detected");
        }
    }

    // Helper function to validate payment amount
    fn validate_amount(amount: i128) {
        if amount < MIN_AMOUNT {
            panic!("Amount below minimum");
        }
        if amount > MAX_TOTAL_AMOUNT {
            panic!("Amount above maximum");
        }
    }

    // Helper function to validate total bill amount
    fn validate_total_amount(amount: i128) {
        if amount < MIN_AMOUNT {
            panic!("Total amount below minimum");
        }
        if amount > MAX_TOTAL_AMOUNT {
            panic!("Total amount above maximum");
        }
    }
}