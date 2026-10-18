import './style.css';
import './seasonal.css';
import { createApp } from './app';
import { initOAuth, signIn, signOut } from './oauth';

void createApp({ initOAuth, signIn, signOut }).start();
