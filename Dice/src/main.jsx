import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { setup, http, bridge, AppEnv } from '@waje/base'

const urlParams = new URLSearchParams(window.location.search);
const accessToken = urlParams.get("token");

let _minUnitBet = 0;
let _maxInitBet = 0;

setup({
    appKey: 'I3adkSazD0NJ',
    appSecret: 'vJxCKT9RrF8g5yl0',
    accessToken: accessToken,
    env: AppEnv.Test
})
getUserInfo(9003);
// 获取用户信息 -
async function getUserInfo(id) {
    try {
        const res = await http.get('/wgame/v1/colorgame/config', { gameId: id });
        if(res.errCode === 0){
            //gid;
            //cashBalance;
            _minUnitBet = res.data.minUnitBet;
            _maxInitBet = res.data.maxUnitBet;
            if (typeof window.initData === 'function') {
                window.initData(_minUnitBet, _maxInitBet, res.data.balance, res.data.isRecharge)
            }
            showBalance(res.data.balance);
        }
        console.log('User info:', res);
    } catch (error) {
        console.error('Error getting user info:', error);
        throw error;
    }
}

function showBalance(count){
    document.getElementById("balanceDisplay").innerHTML = count;
}

// 挂载到 window，供 game.js 调用
window.startBet = async function(betCount1,
                                 betCount2,
                                 betCount3,
                                 betCount4,
                                 betCount5,
                                 betCount6,
                                 cb){
    try {
        let params = {
            gameId:9003,
            unitBet:_minUnitBet,
            bets:[]
        }
        if(betCount1 > 0){
            params.bets.push({colorIndex:0, count:betCount1});
        }
        if(betCount2 > 0){
            params.bets.push({colorIndex:1, count:betCount2});
        }
        if(betCount3 > 0){
            params.bets.push({colorIndex:2, count:betCount3});
        }
        if(betCount4 > 0){
            params.bets.push({colorIndex:3, count:betCount4});
        }
        if(betCount5 > 0){
            params.bets.push({colorIndex:4, count:betCount5});
        }
        if(betCount6 > 0){
            params.bets.push({colorIndex:5, count:betCount6});
        }
        const res = await http.post('/wgame/v1/colorgame/bet', params);
        if(res.errCode === 0){
            console.log("颜色值", res.data.diceResult);
            for(let i = 0; i < res.data.details; ++ i){
                let dice = res.data.details[i];
                console.log(
                    " 颜色索引 ", dice.colorIndex,
                    " 下注次数 ", dice.count,
                    " 下注金额 ", dice.betAmount,
                    " 命中数量 ", dice.hitCount,
                    " 命中倍率 ", dice.multiplier,
                    " 返还金额 ", dice.winAmount
                );
            }
            console.log("单注金额 ", res.data.unitBet);
            console.log("总下注金额 ", res.data.totalBet);
            console.log("总返还金额 ", res.data.totalWin);
            console.log("总输赢 ", res.data.netResult);
            console.log("账户余额 ", res.data.balance);
            console.log("cash余额 ", res.data.cashBalance);
            console.log("是否充值", res.data.isRecharge);

            cb(null, res.data);
        }
    } catch (error) {
        console.error('Error getting user info:', error);
        cb(error);
        throw error;
    }
}

// 调用游戏大厅相关弹窗队列
/**
 参数
 gameId：游戏Id；
 direction：游戏是纵向还是横向，一般是纵向；
 upperLimit：上限金额（该金额是从接口获取）
 */
//bridge.emitInsufficientBetBalance(params?: { gameId?: string | number; direction?: 'horizontal' | 'vertical' }) //下注资产不足弹窗队列
//bridge.emitBetMoneyNotEnough(params?: { gameId?: string | number; direction?: 'horizontal' | 'vertical' }) //结算后资产不足弹窗队列
//bridge.emitFreeUserWithdrawalGuide(params?: { gameId?: string | number; direction?: 'horizontal' | 'vertical' }) // 免费用户下限引导
//birdge.emitFreeUserUpperLimitGuide(params?: { gameId?: string | number; direction?: 'horizontal' | 'vertical', upperLimit?: number }) // 免费用户上限引导

// 监听资产变化
// useEffect(() => {
//     bridge.on('ASSET_INFO', (payload) => {
//         fetchGameConfig()
//     })
//     return () => {
//         bridge.off('ASSET_INFO')
//     }
// }, [])