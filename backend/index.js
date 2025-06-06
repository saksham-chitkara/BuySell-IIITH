import express from "express";
import mongoose from "mongoose";
import { validateInput, validateInput_without_pass } from "./middlewares/signupvalidation.js";
import jwt from "jsonwebtoken";
import { Item, User , Order} from "./db.js";
import bcrypt from "bcrypt";
import { jwt_auth } from "./middlewares/jwtauth.js";
import cors from "cors";
import crypto, { setEngine } from 'crypto';
import axios from 'axios';
import axiosRetry from 'axios-retry';
import dotenv from "dotenv";
import { verifyCaptcha } from "./middlewares/verifyCaptcha.js";
import {cloudinary} from "./cloudinary.js";
dotenv.config();

const app = express();
mongoose.connect("mongodb+srv://sakshamchitkara:Saksham@cluster0.fx609kp.mongodb.net/assignment1");
const jwtpass = process.env.JWT_SECRET;

app.use(express.json({ limit: "50mb" })); 
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(cors());

import CAS from 'cas';
import { log } from "util";

const baseUrl = 'https://login.iiit.ac.in/cas'

var cas = new CAS({
    base_url: 'https://login.iiit.ac.in/cas',
    service: 'http://localhost:3000/api/cas/callback' 
});

app.get('/api/cas-login', (req, res) => {
    const loginUrl = `${baseUrl}/login?service=${encodeURIComponent(cas.service)}`;

    res.json({
        redirectUrl: loginUrl
    });
});


app.get('/api/cas/callback', async (req, res) => {
    var ticket = req.query.ticket;

    if(ticket){
        cas.validate(ticket, function (err, status, email) {
            if(err){
                return res.redirect(`http://localhost:5173/login`);
            } 
            
            const token = jwt.sign({ email }, jwtpass);

            res.redirect(`http://localhost:5173/login?token=${token}`);
        });
    } 
    
    else {
        res.redirect('http://localhost:5173/login');
    }
});


app.post("/api/signup", validateInput, async function(req, res){
    const { first_name, last_name, email, age, contact_no, password } = req.body;

    const old_user = await User.findOne({ email });
    if(old_user){
        return res.status(401).json({
            msg: "Email is already registered!"
        });
    }

    const hashed_pass = await bcrypt.hash(password, 10);

    const newUser = new User({
        first_name,
        last_name,
        email,
        age,
        contact_no,
        password: hashed_pass,
    });

    await newUser.save();

    const token = jwt.sign({email : req.body.email}, jwtpass);

    res.status(200).json({
        msg : "Successfully signed up!",
        token
    })
});


app.post("/api/login", verifyCaptcha, async function(req, res){
    // console.log("hi");
    // console.log(req.body);
    const email = req.body.email;
    const password = req.body.password;
    // console.log(password);

    const user = await User.findOne({ email });
    if(!user){
        return res.status(401).json({
            msg: "User not found!" 
        });
    }

    const comp = await bcrypt.compare(password, user.password);
    if(!comp){
        return res.status(401).json({
            msg: "Invalid password!" 
        });
    }

    const token = jwt.sign({ email: user.email }, jwtpass);

    res.json({
        msg: "Successfully logged in!",
        token,
    });
    
    // console.log("done");

});

app.use(jwt_auth);

app.get("/api/auth", function(req, res){
    res.status(200).json({
        msg: "token is correct"
    });
})

app.get("/api/profile", async function(req, res){
    const token = req.headers.authorization;
    const decoded = jwt.verify(token, jwtpass);
    const email = decoded.email;

    const user = await User.findOne({ email });

    res.json({
        first_name : user.first_name,
        last_name : user.last_name,
        email: user.email,
        contact_no : user.contact_no,
        age : user.age
    });
})

app.put("/api/profile", validateInput_without_pass, async function(req, res) {
    // console.log("hi2");
    const token = req.headers.authorization;
    const decoded = jwt.verify(token, jwtpass);
    const email = decoded.email;

    try {
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(404).json({ msg: "User not found" });
        }

        const updatedData = {
            first_name: req.body.first_name,
            last_name: req.body.last_name,
            age: req.body.age,
            contact_no: req.body.contact_no,
        };

        if (req.body.password) {
            updatedData.password = await bcrypt.hash(req.body.password, 10);
        }

        await User.updateOne({ email }, { $set: updatedData });

        return res.status(200).json({ 
            msg: "Profile updated successfully" 
        });
    } 
    
    catch (err) {
        console.error(err);
        return res.status(401).json({ 
            msg: "Couldn't update the profile" 
        });
    }
});



app.get('/api/items', async function(req, res){
    try{
        const user_ki_id = req.user._id;

        const items = await Item.find({ sellerId: { $ne: user_ki_id}, status : "available" }).populate({
            path: 'sellerId',
            select: 'first_name last_name', 
        });

        const items_with_name = items.map((item) => ({
            id: item.id,
            name: item.name,
            price: item.price,
            description: item.description,
            category: item.category,
            vendor: `${item.sellerId.first_name} ${item.sellerId.last_name}`,
            image: item.image,
        }));

        res.status(200).json({
            items: items_with_name
        });

    } 
    catch(err){
        console.log(err);
        res.status(401).json({ 
            msg: "Error sending items"
        });
    }
});

app.get('/api/items/:id', async function (req, res) {
    try {
        console.log("hi");
        const id = req.params.id;
        // console.log(id);
        const item = await Item.findOne({ id }).populate({
            path: 'sellerId',
            select: 'first_name last_name', 
        });


        if(!item){
            return res.status(401).json({
                msg: 'Item not found' 
            });
        }

        res.status(200).json({
            id: item.id,
            name: item.name,
            price: item.price,
            description: item.description,
            category: item.category,
            vendor: `${item.sellerId.first_name} ${item.sellerId.last_name}`,
            image: item.image,
        });
    } 
    catch(err){
        console.log(err);
        res.status(401).json({
            msg: 'Error fetching item details' 
        });
    }
});

app.put('/api/sell', async function(req, res){

    try{
        const user_ki_id = req.user._id;

        var { name, price, description, category, image } = req.body;

        if(!name || !price || !description || !category || !image){
            return res.status(400).json({
                msg: "All fields are required."
            });
        }

        price = Number(price);

        const result = await cloudinary.uploader.upload(image, {
            folder: "products",
            // width: 300,
            // height: 300,
        })

        const new_item = new Item({
            name,
            price,
            description,
            category,
            sellerId: user_ki_id,
            status: "available",
            image: {
                public_id: result.public_id,
                url: result.secure_url
            },
        });

        // console.log(result.secure_url);

        await new_item.save();

        res.status(200).json({
            msg: "Item successfully added for sale."
        })
    } 
    catch(err){
        console.log(err);
        res.status(401).json({ 
            msg: "Error selling items"
        });
    }
});

app.post("/api/cart", async function (req, res){
    try {
        const user_id = req.user._id;
        const item_id = req.body.item_id;
        const item = await Item.findOne({id : item_id});

        // console.log(item._id);
        // const item_mongo_id = await Item.findOne({id : item_id})._id;
        // console.log(item_mongo_id);


        const user = await User.findById(user_id).populate('cart_items');
        // console.log(user);
        // console.log(user.cart_items);
        // console.log(user.cart_items.length);

        // if(user.cart_items.length == 0){
        //     // console.log("here");
        //     user.cart_items = [];
        // }

        if(!user.cart_items.some((cart_item) => cart_item._id.toString() === item._id.toString())){ //no duplicate abhi k liye to
            // console.log("here2");
            user.cart_items.push(item._id);
        }
        
        await user.save();

        res.status(200).json({ 
            msg: 'Item added to cart successfully' 
        });
    } 
    catch(err){
        console.log(err);
        res.status(401).json({ 
            message: 'Error adding item to cart' 
        });
    }
});

// Cart page wale
app.get('/api/cart', async function(req, res){
    try{
        const user = await User.findById(req.user._id).populate('cart_items');
        // console.log(user.cart_items);

        const cart_items = user.cart_items.filter((item) => item.status === "available");

        // console.log("hi");
        // console.log(cart_items);
        
        res.status(200).json({ 
            cart_items
        });
    } 
    catch(err){
        console.error(err);
        res.status(401).json({
            msg: 'Error fetching cart items' 
        });
    }
});

app.delete('/api/cart/:item_id', async function (req, res){
    try{
        const item_id = req.params.item_id;
        const user = await User.findById(req.user._id);

        user.cart_items = user.cart_items.filter(
            (id) => id.toString() !== item_id
        );

        await user.save();
        res.status(200).json({
            msg: 'Item removed from cart' 
        });
    } 
    catch(err){
        console.log(err);
        res.status(401).json({
            msg: 'Error removing item from cart' 
        });
    }
});


app.get('/api/cart/count', async function (req, res) {
    try {
        const user = await User.findById(req.user._id).populate('cart_items');

        const cart_count = user.cart_items.length;
        // console.log(cart_count);

        res.json({ 
            cart_count
        });
    } 
    
    catch(err){
        console.log(err)
        res.status(401).json({ 
            msg: 'Server error' 
        });
    }
});




app.post('/api/cart/order', async function (req, res) {
    try{
        const user = await User.findById(req.user._id).populate('cart_items');

        for(const item of user.cart_items){
            const otp = Math.floor(1000 + Math.random() * 9000).toString(); 
            const hashedOtp = crypto.createHash('sha256').update(otp).digest('hex');
            //yt video p dkha tha hash.... thapa technical
            // abhi aise hi daal diya h baad mein to regenerate hi krna... tab update hi krna

            const order = new Order({
                buyerId: user._id, 
                sellerId: item.sellerId,
                itemId: item._id, 
                hashedOtp, 
                status: 'pending',
            });
            
            await order.save(); 

            //buyer k order_place mein push kra
            await User.findByIdAndUpdate(user._id,{
                $push: { orders_placed: order._id },
            });

            //seller k order_received mein push kra
            await User.findByIdAndUpdate(item.sellerId,{
                $push: { orders_received: order._id },
            });
        }

        user.cart_items = [];
        await user.save();

        res.status(200).json({
            msg: 'Order placed successfully'
        });
    } 
    
    catch(err){
        console.log(err);
        res.status(401).json({
            msg: 'Error placing order'
        });
    }
});


app.get('/api/history', async function (req, res){
    try {
        const id = req.user._id; 

        const user = await User.findById(id).populate({
            path: 'orders_placed',
            populate: [
                { path: 'itemId', model: 'Item' },
                { path: 'sellerId', model: 'User', select: 'first_name last_name' },
            ],
        })
        .populate({
            path: 'orders_received',
            populate: [
                { path: 'itemId', model: 'Item' },
                { path: 'buyerId', model: 'User', select: 'first_name last_name' },
            ],
        });

        const pending_orders = user.orders_placed.filter(order => order.status === 'pending' && order.itemId.status !== 'sold').map(order => ({
            id: order._id,
            name: order.itemId.name,
            price: order.itemId.price,
            category: order.itemId.category,
            vendor: `${order.sellerId.first_name} ${order.sellerId.last_name}`,
            image: order.itemId.image,
            sellerId: order.sellerId._id
        }));
 
        const items_bought = user.orders_placed.filter(order => order.status === 'completed').map(order => {
            console.log(order.itemId._id);
            console.log("hi")
            return {
                name: order.itemId.name,
                price: order.itemId.price,
                category: order.itemId.category,
                vendor: `${order.sellerId.first_name} ${order.sellerId.last_name}`,
                image: order.itemId.image,
                sellerId: order.sellerId._id,
                itemId: order.itemId._id
            };
        });

        const items_sold = user.orders_received.filter(order => order.status === 'completed').map(order => ({
            name: order.itemId.name,
            price: order.itemId.price,
            category: order.itemId.category,
            buyer: `${order.buyerId.first_name} ${order.buyerId.last_name}`,
            image: order.itemId.image,
            sellerId: order.sellerId._id
        }));

        // console.log(pending_orders);
        
        res.status(200).json({
            pending_orders,
            items_bought,
            items_sold,
        });

    } 
    catch (err){
        console.log(err);
        res.status(401).json({
            msg: 'Unable to fetch the order history' 
        });
    }
});


//otp
app.post('/api/regenerate/:order_id', async function (req, res) {
    console.log("hi");
    try {
        const { order_id } = req.params;

        const otp = Math.floor(1000 + Math.random() * 9000).toString(); 
        const hashedOtp = crypto.createHash('sha256').update(otp).digest('hex'); 

        const order = await Order.findById(order_id);
        if(!order){
            return res.status(401).json({
                msg: 'Order not found' 
            });
        }

        order.hashedOtp = hashedOtp;
        await order.save();

        res.status(200).json({ 
            new_otp: otp 
        });
    } 
    
    catch(err){
        console.log(err);
        res.status(401).json({
            msg: 'Failed to regenerate OTP' 
        });
    }
});

//deliver items page k related routes
app.post('/api/orders/complete/:order_id', async function (req, res){
    const order_id = req.params.order_id;
    const entered_otp = req.body.entered_otp;

    try {
        const order = await Order.findById(order_id);
        if(!order){
            return res.status(401).json({
                msg: 'Order not found' 
            });
        }
        
        const hash = crypto.createHash('sha256').update(entered_otp).digest('hex');

        if(hash !== order.hashedOtp) {
            return res.status(401).json({
                msg: 'Invalid OTP' 
            });
        }

        order.status = 'completed';
        await order.save();

        const item = await Item.findById(order.itemId);
        if(item){
            item.status = 'sold';
            await item.save();
        }

        return res.status(200).json({ 
            msg: 'Transaction completed successfully!' 
        });
    } 
    
    catch(err){
        console.log(err);
        res.status(401).json({ 
            msg: 'Transaction failed!' 
        });
    }
});

app.get('/api/orders/pending', async function (req, res) {
    const sellerId = req.user._id;
    try {
        
        const pending_orders = await Order.find({ sellerId, status: 'pending' }).populate('buyerId', 'first_name last_name')
        .populate('itemId', 'name price status image'); 

        // console.log(pending_orders);
        const to_be_sent = pending_orders.filter((order) => {return order.itemId.status === 'available'}) //for pt 2 in README
        .map((order) => {
            return {
                id: order._id,
                name: order.itemId.name,
                price: order.itemId.price,
                buyer: `${order.buyerId.first_name} ${order.buyerId.last_name}`,
                image: order.itemId.image
            };
        });

        // console.log(to_be_sent);

        res.status(200).json({
            to_be_sent,
        });

    } 
    
    catch(err){
        console.log(err);
        res.status(401).json({ 
            msg: 'Error in retrieving pending order!' 
        });
    }
});


// import { GoogleGenerativeAI } from "@google/generative-ai";

// // Store conversation sessions
// const conversationSessions = new Map();

// const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// const model = genAI.getGenerativeModel({ model: "gemini-pro"});

// app.post('/api/chat', async (req, res) => {
//     const { message, userId, sessionId } = req.body;

//     try {
//         // Retrieve or create session
//         if(!conversationSessions.has(sessionId)){
//             conversationSessions.set(sessionId, [
//                 "You are a helpful assistant for CampusMart, an IIITH marketplace. Provide supportive and friendly responses about buying, selling, and using the platform."
//             ]);
//         }

//         const session = conversationSessions.get(sessionId);
        
//         session.push(`User: ${message}`);

//         const result = await model.generateContent(session.join('\n'));
//         const aiResponse = result.response.text();

//         session.push(`Assistant: ${aiResponse}`);

//         if(session.length > 10){
//             session.splice(1, 2);
//         }

//         res.json({ response: aiResponse });
//     } 
    
//     catch (error) {
//         console.error('Chatbot error:', error);
//         res.status(500).json({ error: 'Failed to generate response' });
//     }
// });

// app.get('/api/chat/new-session', (req, res) => {
//     const sessionId = Date.now().toString();
//     res.json({ sessionId });
// });

// export default app;


import { GoogleGenerativeAI } from "@google/generative-ai";
import { Cloudinary } from "@cloudinary/url-gen/index";

const conversationSessions = new Map();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-pro"});

const WEBSITE_CONTEXT = `
CampusMart Website Features:
1. User Authentication:
   - Login via email/password
   - CAS (Central Authentication Service) login
   - Signup for new users

2. Shop tab:
   - Buy and sell items within IIITH community
   - Categories: clothing, grocery, academics, sports, others
   - Item listing with details are selled, price, description and category

3. User Profile:
   - Manage personal information
   - View cart items
   - Track orders placed and received
   - Track items sold
   - Seller reviews

4. Transaction Process:
   - Browse items
   - Add to cart
   - Go to cart by clicking the icon on navbar
   - click on 'Place order' button. Order for the all the items in the cart will be placed directly
   - Respective seller of the items will then see orders received in 'Orders Received' tab
   - buyer will generate an otp for a pending order in 'Pending Orders' tab and if the seller enters same otp in 'Orders received' tab transaction will be successfull

5. Review:
   - In the 'Purchased items' tab in 'Order History' window, user can give a review about the condition of the product and other things

5. Sell an Item:
   - Go to 'Sell and Item' tab
   - enter the required details i.e. name, price, category, image, description
   - click on sell button

Interaction Guidelines:
- Provide helpful, friendly responses
- Guide users through website features
- Store the context of conversation and give responses as per the conversation
- answer as per the context of the conversation (it is must)
- Prioritize user experience
`;

app.post('/api/chat', async (req, res) => {
    const { message, sessionId } = req.body;

    try {
        // Initialize session if it doesn't exist
        if (!conversationSessions.has(sessionId)) {
            const initialSession = [
                {
                    role: 'system',
                    content: WEBSITE_CONTEXT
                }
            ];
            conversationSessions.set(sessionId, initialSession);
        }

        const session = conversationSessions.get(sessionId);

        // If this is the first message, add welcome message
        if (session.length === 1) {
            if (!message) {
                return res.json({
                    response: "Welcome to CampusMart! How can I help you today?"
                });
            }
        }

        // Add user message to history
        session.push({
            role: 'user', // Changed from 'system' to 'user'
            content: message
        });

        // Format chat history correctly
        const chatHistory = session.map(msg => {
            // Properly format based on role
            const role = msg.role === 'system' ? 'System' :
                        msg.role === 'user' ? 'Human' : 'Assistant';
            return `${role}: ${msg.content}`;
        }).join('\n');

        // Generate response
        const result = await model.generateContent(chatHistory);
        const aiResponse = result.response.text().replace(/^Assistant:\s*/, '');

        // Add AI response to history
        session.push({
            role: 'assistant',
            content: aiResponse
        });

        // Optional: Maintain a reasonable history size (last N messages)
        const MAX_HISTORY = 20;
        if (session.length > MAX_HISTORY) {
            // Keep system message and last (MAX_HISTORY-1) messages
            session.splice(1, session.length - MAX_HISTORY);
        }

        res.json({ response: aiResponse });
    } catch (err) {
        console.error(err);
        res.status(500).json({ // Changed from 401 to 500 for server errors
            error: 'Failed to generate response'
        });
    }
});


app.get('/api/chat/new-session', function (req, res) {
    const sessionId = Date.now().toString();
    res.json({ 
        sessionId 
    });
});

app.post('/api/review', async function (req, res) {
    console.log("hi");
    try {
        const { sellerId, text , itemId} = req.body;
        const reviewerId = req.user._id; 

        // console.log(sellerId);
        // console.log("...............");
        // console.log(text)
        // console.log(itemId)

        if (!sellerId || !text) {
            console.log("err1");
            return res.status(401).json({ msg: 
                'Seller ID and review text are required' 
            });
        }

        const seller = await User.findById(sellerId);
        const item = await Item.findById(itemId);

        if(!seller){
            console.log("err");
            return res.status(401).json({ 
                msg: 'Seller not found' 
            });
        }

        if(!item){
            console.log("err2");
            return res.status(401).json({ 
                msg: 'item not found' 
            });
        }

        seller.seller_reviews.push({ reviewerId, itemId,  text });
        await seller.save();

        res.status(200).json({ 
            msg: 'Review submitted successfully', 
        });
    } 
    
    catch(err){
        console.log(err);
        res.status(401).json({
            msg: 'Server error' 
        });
    }
});

app.get('/api/profile/reviews', async function (req, res) {
    try {
        const user = await User.findById(req.user._id)
            .select('seller_reviews')
            .populate({
                path: 'seller_reviews.reviewerId',
                select: 'first_name last_name'
            })
            .populate({
                path: 'seller_reviews.itemId',
                select: 'name'
            });

        if(!user){
            return res.status(401).json({
                msg: 'User not found' 
            });
        }
        
        const reviews = user.seller_reviews
        res.status(200).json({
            reviews
        });
    } 
    catch (error) {
        console.error('Error fetching reviews:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

app.listen(3000, () => {
    console.log("Server running on port 3000");
});
  
export { jwtpass };

