import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { readFileSync } from 'fs'
import './env.js'

// Requiere la variable FIREBASE_SERVICE_ACCOUNT_PATH en el .env, apuntando al
// archivo JSON de credenciales de servicio descargado desde
// Firebase Console > Configuración del proyecto > Cuentas de servicio > Generar nueva clave privada
const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH

if (!getApps().length) {
    if (!serviceAccountPath) {
        console.warn('FIREBASE_SERVICE_ACCOUNT_PATH no está configurada: la verificación de login con Firebase no funcionará')
    } else {
        try {
            const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'))
            initializeApp({
                credential: cert(serviceAccount)
            })
        } catch (error) {
            console.warn(`No se pudo leer la credencial de Firebase Admin en "${serviceAccountPath}": la verificación de login con Firebase no funcionará`, error.message)
        }
    }
}

// getAuth() se resuelve recién al llamarla (no al importar el módulo), para
// no romper el arranque del servidor si todavía no se configuró la credencial.
export const getFirebaseAuth = () => getAuth()
