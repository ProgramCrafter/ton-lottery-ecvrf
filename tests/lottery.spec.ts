import { randomTestKey } from "ton/dist/utils/randomTestKey";
import { Blockchain, SandboxContract, TreasuryContract } from '@ton-community/sandbox';
import { readFileSync, writeFileSync } from 'fs';
import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Dictionary, Sender, SendMode, Slice, toNano, TupleBuilder } from 'ton';
import { sign } from "ton-crypto";
import { expect } from "chai";
import '@ton-community/test-utils';

let coordinatorCode = Cell.fromBase64("te6ccgECGwEABDUAART/APSkE/S88sgLAQIBIAIDAgFIBAUC9vLtRND0BNM/0wfTD1UwbwQB+kDT/9P/0x8wM/gjUAO88uCCA9QB0O1E+QBAE/kQ8uCD+ADtRNAg10mpOALtRPkAWdcDyMsHy/8ibyTtRNCAINcj+CMFyPQAFMs/EssHyw8BgQML1yLPFssfye1UQwDbPIIQBpzsqMjLHxgZAdTQINdJwSDjCAHQ0wMBcbAB+kAwAeMIAdMfIYIQq0xIWbqORTBsEoIQywO/r7qONu1E0PQB0z941yHTD/pAMFEzxwXy4KumMoIID0JAqAGocPsCcIAYyMsFWM8WIfoCy2rJgwb7AJEw4uMNBgIBIAcIAM5sIe1E0PQE0z/TB9MPBoIImJaAoSGmPIIID0JAqKkEIMEB4wgF+kAwUwSBAQv0Cm+hs5owAqQghAe88tCql9cLPxagRRXiUTWgBcjLP0AEgQEL9EFQJATI9AATyz/LB8sPAc8Wye1UAgFICQoCASAMDQAjtVidqJoegJpn+mD6YeIEi+CQAfu1zaQ/JLkLGeLQXgWcckwfoNWVjN1V+Vhlni7KOpsJiJuTOqvMAhBad+lUcF4doqxR2RqlrfQg1bDC0DtgTpXsg8IeCBjcteyiimVqfzkZf+sZ4vl/7j8ggC3kXyQKYF8kimYgORl/7j8ggBVv+Rlv+X/uPyCAHyTVIQQfJLALAGhTMfkkIxBGEDVZBMjL/xPL/8v/AcjL/xLL/3L5BACpOH9SBKig+SapCAHIy/8Sy3/L/8nQAgEgDg8CASAUFQIBWBARAgEgEhMAIa5P9qJoegJpn+mD6YeKL4JAAQWt6sAYAAewsp/gAEGxw7tRND0BNM/0wfTDxRfBKY8gggPQkCoAaiCCJiWgKCACASAWFwAzt/s9qJoEGuk1JwBdqJ8gCzrgeRlg+X/5OhAACbD/PklgACOyjPtRND0BNM/0wfTDxA0XwSAB7tP/Ifkh03/T/zADgvAs45Jg/QasrGbqr8rDLPF2UdTYTETcmdVeYBCC079Ko4Lw7RVijsjVLW+hBq2GFoHbAnSvZB4Q8EDG5a9lFFMrU/nIy/9YzxfL/3H5BAFvIvkgUwP5JF35JPkjBPklU1L5JPkjEDVURRMFGgDoy//JAW8kbVEyoSKOQASBAQv0kvLglgHXCz8gwgGcpcjLP1QgBoEBC/RBlTADpQME4nGAGMjLBVAGzxaCCcnDgPoCFctqUmDMyXL7AATkNDRQA+1E0IAg1yP4IwXI9AAUyz8SywfLDwGBAwvXIs8Wyx/J7VQA1gTIy/8Ty//L/wHIy/8Sy/9y+QQAqTh/uvLgZILwSFSSpO6TpQQ1KStyiS8XYXs6AHh/xFiZxPIU5Lqmp62C8O0VYo7I1S1voQathhaB2wJ0r2QeEPBAxuWvZRRTK1P5yMv/Esv/y/9x+QQA");
let lotteryCode = Cell.fromBoc(readFileSync('./build/boc/lottery.boc'))[0];

class CoordinatorUnit implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) { }

    static createFromOwnerAndKey(owner: Address, publicKeyEcvrf: bigint, publicKeyReplay: Buffer) {
        const data = beginCell()
            .storeUint(0, 1 + 64 + 8 + 16)
            .storeAddress(owner)
            .storeUint(publicKeyEcvrf, 256)
            .storeBuffer(publicKeyReplay)
            .storeUint(0, 32)
            .endCell();
        const init = { code: coordinatorCode, data };
        return new CoordinatorUnit(contractAddress(0, init), init);
    }

    async sendSubscribeRandom(provider: ContractProvider, via: Sender, value: bigint, consumer?: Address) {
        consumer = consumer ?? via.address!!;

        await provider.internal(via, {
            value,
            body: beginCell()
                .storeUint(0xAB4C4859, 32)
                .storeAddress(consumer)
                .endCell(),
            sendMode: SendMode.PAY_GAS_SEPARATELY
        });
    }

    async getAlpha(provider: ContractProvider): Promise<Slice> {
        const result = await provider.get('get_alpha', []);
        const alpha = result.stack.pop();
        if (alpha.type != 'slice') throw new Error('get-method returned invalid value');
        return alpha.cell.beginParse();
    }

    async sendProvideRandomness(provider: ContractProvider, pi: Slice, secretReplay: Buffer) {
        const contractState = (await provider.getState()).state;
        if (contractState.type != 'active') throw new Error('invalid contract state');
        const hashToSign = Cell.fromBoc(contractState.data!!)[0].hash();
        const signature = beginCell().storeBuffer(sign(hashToSign, secretReplay)).endCell();
        await provider.external(beginCell().storeSlice(pi).storeRef(signature).endCell());
    }

    async getBalance(provider: ContractProvider): Promise<Number> {
        return Number((await provider.getState()).balance) / 1e9;
    }

    async getCalcPiFromAlpha(provider: ContractProvider, secret: bigint, alpha: Slice): Promise<Slice> {
        let args = new TupleBuilder();
        args.writeNumber(secret);
        args.writeSlice(alpha);
        const result = await provider.get('ecvrf::rist255::with_secret::prove', args.build());
        const pi = result.stack.pop();
        if (pi.type != 'slice') throw new Error('get-method returned invalid value');
        return pi.cell.beginParse();
    }

    async sendDeploy(provider: ContractProvider, via: Sender) {
        await provider.internal(via, {
            value: toNano('1.0'),
            body: beginCell().endCell(),
            bounce: false
        });
    }

    async getPublicKey(provider: ContractProvider, secret: bigint): Promise<bigint> {
        let args = new TupleBuilder();
        args.writeNumber(secret);
        return (await provider.get('rist255::get_public_key', args.build())).stack.readBigNumber();
    }

    async sendWithdraw(provider: ContractProvider, via: Sender) {
        await provider.internal(via, {
            value: toNano('0.1'),
            body: beginCell().storeUint(0xCB03BFAF, 32).endCell(),
            bounce: true
        });
    }

    async getUnfulfilled(provider: ContractProvider): Promise<number> {
        return (await provider.get('get_unfulfilled', [])).stack.readNumber();
    }
}

class LotteryUint implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) { }

    static createFromAddress(owner: Slice, ecvrf: Slice) {
        const data = beginCell()
        .storeUint(0, 64 + 64 + 256 + 256)
        .storeBit(1)
        .storeDict(Dictionary.empty(Dictionary.Keys.Int(64), {
            serialize(_src, builder) {
                builder.storeUint(SendMode.PAY_GAS_SEPARATELY, 8);
                builder.storeRef(beginCell()
                .storeUint(0, 64 + 4 + 64)
                .storeCoins(0)
                .storeSlice(owner)
                .endCell());
            },
            parse(src) {
                let sendMode = src.loadUint(8);
                let message = src.loadRef().beginParse();
                return { sendMode, message };
            },
        }))
        .storeRef(
            beginCell()
            .storeSlice(owner)
            .storeSlice(ecvrf)
            .storeSlice(owner)
            .storeCoins(0)
            .endCell()
        )
        .endCell();
        const init = { code: lotteryCode, data };
        return new LotteryUint(contractAddress(0, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value: value,
            body: beginCell().storeUint(1, 32).storeAddress(via.address).storeCoins(value).endCell(),
            bounce: false
        });
    }

    async sendPlayerBet(provider: ContractProvider, via: Sender, value: bigint, player: Address) {
        await provider.internal(via, {
            value: toNano('1.0'),
            body: beginCell().storeUint(0, 32).storeAddress(player).storeCoins(value).endCell(),
            sendMode: SendMode.PAY_GAS_SEPARATELY
        });
    }

    async sendRandomNumber(provider: ContractProvider, via: Sender, value: bigint, random: number) {
        await provider.internal(via, {
            value: value,
            body: beginCell().storeUint(0x069CECA8, 32).storeUint(random, 256).endCell(),
            sendMode: SendMode.PAY_GAS_SEPARATELY
        });
    }

    async getBalance(provider: ContractProvider) {
        return (await provider.get('balance', [])).stack.readNumber();
    }

    async getNumberOfWins(provider: ContractProvider) {
      return (await provider.get('get_number_of_wins', [])).stack.readNumber();
    }
}

describe("lottery test", () => {
    let blockchain: Blockchain;
    let ecvrf: SandboxContract<CoordinatorUnit>;
    let lottery: SandboxContract<LotteryUint>;
    const secretEcvrf = 123456n;
    const keyReplay = randomTestKey('ecvrf-coordinator');
    let deployer: SandboxContract<TreasuryContract>;
    const initialBet = 10000000000n;

    beforeEach(async () => {
        blockchain = await Blockchain.create({ config: 'slim' });
        deployer = await blockchain.treasury('deployer');
        let ecvrf_zeroRist255key = blockchain.openContract(CoordinatorUnit.createFromOwnerAndKey(deployer.address ,0n ,keyReplay.publicKey));
        await ecvrf_zeroRist255key.sendDeploy(deployer.getSender());
        const publicRistKey = await ecvrf_zeroRist255key.getPublicKey(secretEcvrf);
        ecvrf = blockchain.openContract(CoordinatorUnit.createFromOwnerAndKey(deployer.address, publicRistKey, keyReplay.publicKey));
        await ecvrf.sendDeploy(deployer.getSender());
        lottery = blockchain.openContract(LotteryUint.createFromAddress(
            beginCell().storeAddress(deployer.address).asSlice(), 
            beginCell().storeAddress(ecvrf.address).asSlice()
        ));
        await lottery.sendDeploy(deployer.getSender(), initialBet * 4n + 1000000000n);

        await ecvrf.sendSubscribeRandom(deployer.getSender(), 610000000n, lottery.address);
    })

    it("should give lottery to winner", async () => {
        let mockEcvrf = await blockchain.treasury("mock-ecvrf");

        lottery = blockchain.openContract(LotteryUint.createFromAddress( 
            beginCell().storeAddress(deployer.address).asSlice(),  
            beginCell().storeAddress(mockEcvrf.address).asSlice()
        ));
        await lottery.sendDeploy(deployer.getSender(), initialBet * 4n + 1000000000n);

        const player1 = await blockchain.treasury('player1');
        const player2 = await blockchain.treasury('player2');

        let rnd = 177;
        await lottery.sendRandomNumber(mockEcvrf.getSender(), 30000000n, rnd)
        await lottery.sendPlayerBet(player1.getSender(), initialBet, player1.address)
        
        rnd = 175;
        await lottery.sendRandomNumber(mockEcvrf.getSender(), 30000000n, rnd)
        await lottery.sendPlayerBet(player2.getSender(), initialBet, player2.address)
        
        rnd = 177;
        await lottery.sendRandomNumber(mockEcvrf.getSender(), 30000000n, rnd)
        await lottery.sendPlayerBet(player2.getSender(), initialBet, player2.address)
        
        rnd = 177;
        await lottery.sendRandomNumber(mockEcvrf.getSender(), 30000000n, rnd)
        await lottery.sendPlayerBet(player1.getSender(), initialBet, player1.address)
        
        rnd = 173;
        await lottery.sendRandomNumber(mockEcvrf.getSender(), 30000000n, rnd)
        
        const player1FinalBalance = await player1.getBalance();
        const player2FinalBalance = await player2.getBalance();
        expect(player1FinalBalance - player2FinalBalance).to.be.equal(19999691000n);
        expect(await lottery.getNumberOfWins()).to.equal(1);
    })
})