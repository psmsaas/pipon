import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, doc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const app = initializeApp({
    apiKey: "AIzaSyBjzZmNyG_NmfNlEc3QusG55YLYIUwXIQY",
    authDomain: "sistema-pipon.firebaseapp.com",
    projectId: "sistema-pipon",
    storageBucket: "sistema-pipon.firebasestorage.app",
    messagingSenderId: "726758496600",
    appId: "1:726758496600:web:4a83534bdc337f4535ed2d"
});

export const db = getFirestore(app);
export const auth = getAuth(app);
export const dominioAuth = app.options.authDomain;

export const coleccion = (nombre) => collection(db, 'negocio', 'pipon', nombre);
export const documento = (nombre, id) => doc(db, 'negocio', 'pipon', nombre, id);
