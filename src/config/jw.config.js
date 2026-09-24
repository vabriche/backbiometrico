import jwt from 'jsonwebtoken'
import './env.js'

export const createToken=(user)=>{
    const token= jwt.sign({user},process.env.PRIVATE_KEY_JWT, {expiresIn:'8h', algorithm:'HS256'})
    return token

}

export const verifyJWT = (token) => {
    return jwt.verify(token, process.env.PRIVATE_KEY_JWT, {algorithms:['HS256']})
}
