import jwt from 'jsonwebtoken'
import dotenv from 'dotenv'
dotenv.config()

export const createToken=(user)=>{
    const token= jwt.sign({user},process.env.PRIVATE_KEY_JWT, {expiresIn:'8h'})
    return token

}

export const verifyJWT = (token) => {
    return jwt.verify(token, process.env.PRIVATE_KEY_JWT)
}
