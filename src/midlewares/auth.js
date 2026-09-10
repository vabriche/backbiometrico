import { verifyJWT } from '../config/jw.config.js'

export const verifyToken = (req, res, next) => {
    const authHeader = req.headers.authorization

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Token no proporcionado' })
    }

    const token = authHeader.split(' ')[1]

    try {
        const decoded = verifyJWT(token)
        req.user = decoded.user
        next()
    } catch (error) {
        return res.status(401).json({ error: 'Token inválido o expirado' })
    }
}

// Exige JWT solo en operaciones de escritura (POST/PUT/PATCH/DELETE);
// las lecturas (GET) quedan libres.
export const verifyTokenWrites = (req, res, next) => {
    if (req.method === 'GET') {
        return next()
    }
    return verifyToken(req, res, next)
}
