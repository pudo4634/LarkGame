import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { setup, http, bridge, AppEnv } from '@waje/base'

const urlParams = new URLSearchParams(window.location.search);
const accessToken = urlParams.get("token");

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
        console.log('User info:', res);
        showBalance(res);
    } catch (error) {
        console.error('Error getting user info:', error);
        throw error;
    }
}

function showBalance(count){
    document.getElementById("balanceDisplay").innerHTML = count;
}

createRoot(document.getElementById('root')).render(
    <StrictMode>
        <App />
    </StrictMode>,
)
