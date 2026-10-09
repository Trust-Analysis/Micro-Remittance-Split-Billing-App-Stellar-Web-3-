#![no_std]
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, token, Address, Env,
};

/// Error codes returned by the Split Bill contract.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    BillNotFound = 3,
    BillInactive = 4,
    InvalidAmount = 5,
    OverpaymentNotAllowed = 6,
    Unauthorized = 7,
    PayeeCannotBePayer = 8,
    ArithmeticOverflow = 9,
    MaxBillIdReached = 10,
    SameRemitParties = 11,
    ReentrancyLockActive = 12,
}

/// Representation of an on-chain split bill.
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

/// Storage keys for contract instance and persistent state.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    Bill(u32),
    BillCount,
    ReentrancyLock,
}

// Contract events
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RemitEvent {
    #[topic]
    pub from: Address,
    pub to: Address,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BillCreatedEvent {
    #[topic]
    pub bill_id: u32,
    pub payee: Address,
    pub total_amount: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BillPaidEvent {
    #[topic]
    pub bill_id: u32,
    pub payer: Address,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BillCompletedEvent {
    #[topic]
    pub bill_id: u32,
    pub total_amount: i128,
    pub participant_count: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BillClosedEvent {
    #[topic]
    pub bill_id: u32,
    pub admin: Address,
}

// TTL management thresholds (in ledgers, ~5s per ledger on Stellar)
pub const INSTANCE_TTL_LOW: u32 = 10_000;
pub const INSTANCE_TTL_HIGH: u32 = 20_000;
pub const PERSISTENT_TTL_LOW: u32 = 20_000;
pub const PERSISTENT_TTL_HIGH: u32 = 50_000;

// Constraints on amounts and IDs
pub const MIN_AMOUNT: i128 = 1; // 1 stroop minimum
pub const MAX_TOTAL_AMOUNT: i128 = 10_000_000_000_000_000; // 10M XLM max stroops
pub const MAX_BILL_ID: u32 = 1_000_000;

#[contract]
pub struct SplitBillContract;

#[contractimpl]
impl SplitBillContract {
    /// Initialize the contract with an admin address. Can only be invoked once.
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }

        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::BillCount, &0u32);
        env.storage()
            .instance()
            .set(&DataKey::ReentrancyLock, &false);

        env.storage()
            .instance()
            .extend_ttl(INSTANCE_TTL_LOW, INSTANCE_TTL_HIGH);

        Ok(())
    }

    /// Retrieve the current administrator address.
    pub fn get_admin(env: Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)
    }

    /// Micro-remittance: Direct peer-to-peer payment wrapper with strict validation.
    pub fn remit(
        env: Env,
        from: Address,
        to: Address,
        token: Address,
        amount: i128,
    ) -> Result<(), Error> {
        Self::validate_amount(amount)?;

        if from == to {
            return Err(Error::SameRemitParties);
        }

        from.require_auth();

        let client = token::Client::new(&env, &token);
        client.transfer(&from, &to, &amount);

        RemitEvent { from, to, amount }.publish(&env);

        Ok(())
    }

    /// Creates a new split bill and returns the newly assigned Bill ID.
    pub fn create_bill(
        env: Env,
        payee: Address,
        token: Address,
        total_amount: i128,
    ) -> Result<u32, Error> {
        Self::ensure_initialized(&env)?;
        Self::validate_total_amount(total_amount)?;

        payee.require_auth();

        Self::acquire_reentrancy_lock(&env)?;

        let count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::BillCount)
            .unwrap_or(0);

        if count >= MAX_BILL_ID {
            Self::release_reentrancy_lock(&env);
            return Err(Error::MaxBillIdReached);
        }

        let new_id = count.checked_add(1).ok_or(Error::ArithmeticOverflow)?;

        let bill = SplitBill {
            payee: payee.clone(),
            token,
            total_amount,
            amount_collected: 0,
            is_active: true,
            created_at: env.ledger().sequence() as u64,
            participant_count: 0,
        };

        let bill_key = DataKey::Bill(new_id);
        env.storage().persistent().set(&bill_key, &bill);
        env.storage()
            .persistent()
            .extend_ttl(&bill_key, PERSISTENT_TTL_LOW, PERSISTENT_TTL_HIGH);

        env.storage().instance().set(&DataKey::BillCount, &new_id);
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_TTL_LOW, INSTANCE_TTL_HIGH);

        Self::release_reentrancy_lock(&env);

        BillCreatedEvent {
            bill_id: new_id,
            payee,
            total_amount,
        }
        .publish(&env);

        Ok(new_id)
    }

    /// Allows a participant to contribute to a split bill.
    pub fn pay_bill(env: Env, payer: Address, bill_id: u32, amount: i128) -> Result<(), Error> {
        Self::ensure_initialized(&env)?;
        Self::validate_amount(amount)?;

        payer.require_auth();

        Self::acquire_reentrancy_lock(&env)?;

        let bill_key = DataKey::Bill(bill_id);
        let mut bill: SplitBill = match env.storage().persistent().get(&bill_key) {
            Some(b) => b,
            None => {
                Self::release_reentrancy_lock(&env);
                return Err(Error::BillNotFound);
            }
        };

        if !bill.is_active {
            Self::release_reentrancy_lock(&env);
            return Err(Error::BillInactive);
        }

        if payer == bill.payee {
            Self::release_reentrancy_lock(&env);
            return Err(Error::PayeeCannotBePayer);
        }

        let new_collected = match bill.amount_collected.checked_add(amount) {
            Some(v) => v,
            None => {
                Self::release_reentrancy_lock(&env);
                return Err(Error::ArithmeticOverflow);
            }
        };

        if new_collected > bill.total_amount {
            Self::release_reentrancy_lock(&env);
            return Err(Error::OverpaymentNotAllowed);
        }

        // Direct settlement to the payee
        let client = token::Client::new(&env, &bill.token);
        client.transfer(&payer, &bill.payee, &amount);

        bill.amount_collected = new_collected;
        bill.participant_count = match bill.participant_count.checked_add(1) {
            Some(v) => v,
            None => {
                Self::release_reentrancy_lock(&env);
                return Err(Error::ArithmeticOverflow);
            }
        };

        let is_completed = bill.amount_collected >= bill.total_amount;
        if is_completed {
            bill.is_active = false;
        }

        env.storage().persistent().set(&bill_key, &bill);
        env.storage()
            .persistent()
            .extend_ttl(&bill_key, PERSISTENT_TTL_LOW, PERSISTENT_TTL_HIGH);

        env.storage()
            .instance()
            .extend_ttl(INSTANCE_TTL_LOW, INSTANCE_TTL_HIGH);

        Self::release_reentrancy_lock(&env);

        if is_completed {
            BillCompletedEvent {
                bill_id,
                total_amount: bill.amount_collected,
                participant_count: bill.participant_count,
            }
            .publish(&env);
        } else {
            BillPaidEvent {
                bill_id,
                payer,
                amount,
            }
            .publish(&env);
        }

        Ok(())
    }

    /// Query current status of a split bill with automatic TTL bump.
    pub fn get_bill(env: Env, bill_id: u32) -> Result<SplitBill, Error> {
        let bill_key = DataKey::Bill(bill_id);
        let bill: SplitBill = env
            .storage()
            .persistent()
            .get(&bill_key)
            .ok_or(Error::BillNotFound)?;

        env.storage()
            .persistent()
            .extend_ttl(&bill_key, PERSISTENT_TTL_LOW, PERSISTENT_TTL_HIGH);

        Ok(bill)
    }

    /// Query the total number of split bills created.
    pub fn get_bill_count(env: Env) -> u32 {
        let count = env
            .storage()
            .instance()
            .get(&DataKey::BillCount)
            .unwrap_or(0);

        env.storage()
            .instance()
            .extend_ttl(INSTANCE_TTL_LOW, INSTANCE_TTL_HIGH);

        count
    }

    /// Admin function to close a bill (emergency stop / cancellation).
    pub fn close_bill(env: Env, admin: Address, bill_id: u32) -> Result<(), Error> {
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;

        if admin != stored_admin {
            return Err(Error::Unauthorized);
        }

        admin.require_auth();

        let bill_key = DataKey::Bill(bill_id);
        let mut bill: SplitBill = env
            .storage()
            .persistent()
            .get(&bill_key)
            .ok_or(Error::BillNotFound)?;

        if !bill.is_active {
            return Err(Error::BillInactive);
        }

        bill.is_active = false;

        env.storage().persistent().set(&bill_key, &bill);
        env.storage()
            .persistent()
            .extend_ttl(&bill_key, PERSISTENT_TTL_LOW, PERSISTENT_TTL_HIGH);

        BillClosedEvent { bill_id, admin }.publish(&env);

        Ok(())
    }

    // Helper functions
    fn ensure_initialized(env: &Env) -> Result<(), Error> {
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::NotInitialized);
        }
        Ok(())
    }

    fn acquire_reentrancy_lock(env: &Env) -> Result<(), Error> {
        let in_progress: bool = env
            .storage()
            .instance()
            .get(&DataKey::ReentrancyLock)
            .unwrap_or(false);

        if in_progress {
            return Err(Error::ReentrancyLockActive);
        }

        env.storage()
            .instance()
            .set(&DataKey::ReentrancyLock, &true);
        Ok(())
    }

    fn release_reentrancy_lock(env: &Env) {
        env.storage()
            .instance()
            .set(&DataKey::ReentrancyLock, &false);
    }

    fn validate_amount(amount: i128) -> Result<(), Error> {
        if !(MIN_AMOUNT..=MAX_TOTAL_AMOUNT).contains(&amount) {
            return Err(Error::InvalidAmount);
        }
        Ok(())
    }

    fn validate_total_amount(amount: i128) -> Result<(), Error> {
        if !(MIN_AMOUNT..=MAX_TOTAL_AMOUNT).contains(&amount) {
            return Err(Error::InvalidAmount);
        }
        Ok(())
    }
}

#[cfg(test)]
mod test;
