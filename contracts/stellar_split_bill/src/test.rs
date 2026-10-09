#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events},
    token::StellarAssetClient,
    Address, Env,
};

struct TestSetup {
    env: Env,
    client: SplitBillContractClient<'static>,
    admin: Address,
    payee: Address,
    payer1: Address,
    payer2: Address,
    token: Address,
}

impl TestSetup {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(SplitBillContract, ());
        let client = SplitBillContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let payee = Address::generate(&env);
        let payer1 = Address::generate(&env);
        let payer2 = Address::generate(&env);

        let token_admin_addr = Address::generate(&env);
        let token = env
            .register_stellar_asset_contract_v2(token_admin_addr)
            .address();
        let token_admin = StellarAssetClient::new(&env, &token);

        // Pre-mint tokens
        token_admin.mint(&payer1, &100_000i128);
        token_admin.mint(&payer2, &100_000i128);

        // Cast lifetime for test struct ergonomics
        let client_static = unsafe {
            core::mem::transmute::<SplitBillContractClient<'_>, SplitBillContractClient<'static>>(
                client,
            )
        };

        Self {
            env,
            client: client_static,
            admin,
            payee,
            payer1,
            payer2,
            token,
        }
    }
}

#[test]
fn test_initialize_success() {
    let setup = TestSetup::new();
    assert_eq!(setup.client.try_initialize(&setup.admin), Ok(Ok(())));
    assert_eq!(setup.client.get_admin(), setup.admin);
    assert_eq!(setup.client.get_bill_count(), 0);
}

#[test]
fn test_double_initialize_fails() {
    let setup = TestSetup::new();
    setup.client.initialize(&setup.admin);
    let res = setup.client.try_initialize(&setup.admin);
    assert_eq!(res, Err(Ok(Error::AlreadyInitialized)));
}

#[test]
fn test_uninitialized_calls_fail() {
    let setup = TestSetup::new();
    let res = setup
        .client
        .try_create_bill(&setup.payee, &setup.token, &1000i128);
    assert_eq!(res, Err(Ok(Error::NotInitialized)));

    let res = setup.client.try_pay_bill(&setup.payer1, &1u32, &500i128);
    assert_eq!(res, Err(Ok(Error::NotInitialized)));
}

#[test]
fn test_create_bill_happy_path() {
    let setup = TestSetup::new();
    setup.client.initialize(&setup.admin);

    let total = 5000i128;
    let bill_id = setup.client.create_bill(&setup.payee, &setup.token, &total);

    assert_eq!(bill_id, 1);
    assert_eq!(setup.client.get_bill_count(), 1);

    let bill = setup.client.get_bill(&bill_id);
    assert_eq!(bill.payee, setup.payee);
    assert_eq!(bill.token, setup.token);
    assert_eq!(bill.total_amount, total);
    assert_eq!(bill.amount_collected, 0);
    assert!(bill.is_active);
    assert_eq!(bill.participant_count, 0);
}

#[test]
fn test_create_bill_invalid_amounts() {
    let setup = TestSetup::new();
    setup.client.initialize(&setup.admin);

    // Below minimum
    let res = setup
        .client
        .try_create_bill(&setup.payee, &setup.token, &0i128);
    assert_eq!(res, Err(Ok(Error::InvalidAmount)));

    let res = setup
        .client
        .try_create_bill(&setup.payee, &setup.token, &-50i128);
    assert_eq!(res, Err(Ok(Error::InvalidAmount)));

    // Above maximum
    let res = setup
        .client
        .try_create_bill(&setup.payee, &setup.token, &(MAX_TOTAL_AMOUNT + 1));
    assert_eq!(res, Err(Ok(Error::InvalidAmount)));
}

#[test]
fn test_pay_bill_and_token_balances() {
    let setup = TestSetup::new();
    setup.client.initialize(&setup.admin);

    let total = 2000i128;
    let bill_id = setup.client.create_bill(&setup.payee, &setup.token, &total);

    let token_client = token::Client::new(&setup.env, &setup.token);
    assert_eq!(token_client.balance(&setup.payer1), 100_000);
    assert_eq!(token_client.balance(&setup.payee), 0);

    // Payer 1 pays partial amount (1000)
    setup.client.pay_bill(&setup.payer1, &bill_id, &1000i128);

    assert_eq!(token_client.balance(&setup.payer1), 99_000);
    assert_eq!(token_client.balance(&setup.payee), 1000);

    let bill = setup.client.get_bill(&bill_id);
    assert_eq!(bill.amount_collected, 1000);
    assert_eq!(bill.participant_count, 1);
    assert!(bill.is_active);

    // Payer 2 pays the remainder (1000)
    setup.client.pay_bill(&setup.payer2, &bill_id, &1000i128);

    assert_eq!(token_client.balance(&setup.payer2), 99_000);
    assert_eq!(token_client.balance(&setup.payee), 2000);

    let completed_bill = setup.client.get_bill(&bill_id);
    assert_eq!(completed_bill.amount_collected, 2000);
    assert_eq!(completed_bill.participant_count, 2);
    assert!(!completed_bill.is_active); // Bill should now be completed/inactive
}

#[test]
fn test_pay_bill_overpayment_rejected() {
    let setup = TestSetup::new();
    setup.client.initialize(&setup.admin);

    let total = 1000i128;
    let bill_id = setup.client.create_bill(&setup.payee, &setup.token, &total);

    // Payer tries to pay 1001 when total is 1000
    let res = setup
        .client
        .try_pay_bill(&setup.payer1, &bill_id, &1001i128);
    assert_eq!(res, Err(Ok(Error::OverpaymentNotAllowed)));

    // Pay 600
    setup.client.pay_bill(&setup.payer1, &bill_id, &600i128);

    // Try paying 500 when only 400 remains
    let res2 = setup.client.try_pay_bill(&setup.payer2, &bill_id, &500i128);
    assert_eq!(res2, Err(Ok(Error::OverpaymentNotAllowed)));
}

#[test]
fn test_payee_cannot_be_payer() {
    let setup = TestSetup::new();
    setup.client.initialize(&setup.admin);

    let bill_id = setup
        .client
        .create_bill(&setup.payee, &setup.token, &1000i128);

    // Payee attempts to contribute to their own bill
    let res = setup.client.try_pay_bill(&setup.payee, &bill_id, &500i128);
    assert_eq!(res, Err(Ok(Error::PayeeCannotBePayer)));
}

#[test]
fn test_paying_inactive_or_completed_bill() {
    let setup = TestSetup::new();
    setup.client.initialize(&setup.admin);

    let total = 1000i128;
    let bill_id = setup.client.create_bill(&setup.payee, &setup.token, &total);

    // Complete the bill
    setup.client.pay_bill(&setup.payer1, &bill_id, &total);

    // Try paying completed bill
    let res = setup.client.try_pay_bill(&setup.payer2, &bill_id, &100i128);
    assert_eq!(res, Err(Ok(Error::BillInactive)));
}

#[test]
fn test_admin_close_bill() {
    let setup = TestSetup::new();
    setup.client.initialize(&setup.admin);

    let bill_id = setup
        .client
        .create_bill(&setup.payee, &setup.token, &1000i128);

    // Admin emergency stop
    setup.client.close_bill(&setup.admin, &bill_id);

    let bill = setup.client.get_bill(&bill_id);
    assert!(!bill.is_active);

    // Further payments blocked
    let res = setup.client.try_pay_bill(&setup.payer1, &bill_id, &500i128);
    assert_eq!(res, Err(Ok(Error::BillInactive)));
}

#[test]
fn test_unauthorized_close_bill() {
    let setup = TestSetup::new();
    setup.client.initialize(&setup.admin);

    let bill_id = setup
        .client
        .create_bill(&setup.payee, &setup.token, &1000i128);

    // Non-admin tries to close bill
    let unauthorized = Address::generate(&setup.env);
    let res = setup.client.try_close_bill(&unauthorized, &bill_id);
    assert_eq!(res, Err(Ok(Error::Unauthorized)));
}

#[test]
fn test_remit_peer_to_peer() {
    let setup = TestSetup::new();

    let token_client = token::Client::new(&setup.env, &setup.token);
    assert_eq!(token_client.balance(&setup.payer1), 100_000);
    assert_eq!(token_client.balance(&setup.payee), 0);

    // Remit 2500 stroops directly
    setup
        .client
        .remit(&setup.payer1, &setup.payee, &setup.token, &2500i128);

    assert_eq!(token_client.balance(&setup.payer1), 97_500);
    assert_eq!(token_client.balance(&setup.payee), 2500);

    // Same parties should fail
    let res = setup
        .client
        .try_remit(&setup.payer1, &setup.payer1, &setup.token, &500i128);
    assert_eq!(res, Err(Ok(Error::SameRemitParties)));
}

#[test]
fn test_bill_count_progression() {
    let setup = TestSetup::new();
    setup.client.initialize(&setup.admin);

    assert_eq!(setup.client.get_bill_count(), 0);

    let id1 = setup
        .client
        .create_bill(&setup.payee, &setup.token, &1000i128);
    assert_eq!(id1, 1);
    assert_eq!(setup.client.get_bill_count(), 1);

    let id2 = setup
        .client
        .create_bill(&setup.payee, &setup.token, &2000i128);
    assert_eq!(id2, 2);
    assert_eq!(setup.client.get_bill_count(), 2);
}

#[test]
fn test_events_published() {
    let setup = TestSetup::new();
    setup.client.initialize(&setup.admin);

    let bill_id = setup
        .client
        .create_bill(&setup.payee, &setup.token, &1000i128);
    setup.client.pay_bill(&setup.payer1, &bill_id, &500i128);

    // Verify events were emitted
    let events = setup.env.events().all();
    assert!(!events.events().is_empty());
}
