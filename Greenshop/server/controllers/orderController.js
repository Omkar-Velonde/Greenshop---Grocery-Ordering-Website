import Order from "../models/Order.js";
import Product from "../models/Product.js";
import stripe from "stripe"
import User from "../models/User.js"

// Place Order COD : /api/order/cod
export const placeOrderCOD = async (req, res) => {
    try {
        const { userId, items, address } = req.body;
        if (!address || items.length === 0) {
            return res.json({ success: false, message: "Invalid data" })
        }
        // Calculate Amount Using Items
        let amount = await items.reduce(async (acc, item) => {
            const product = await Product.findById(item.product);
            return (await acc) + product.offerPrice * item.quantity;
        }, 0)

        // Add Tax Charge (2%)
        amount += Math.floor(amount * 0.02);

        await Order.create({
            userId,
            items,
            amount,
            address,
            paymentType: "COD",
        });

        return res.json({ success: true, message: "Order Placed Successfully" })
    } catch (error) {
        return res.json({ success: false, message: error.message });
    }
}

// Place Order Stripe : /api/order/stripe
export const placeOrderStripe = async (req, res) => {
    try {
        const { userId, items, address } = req.body;
        const { origin } = req.headers;

        if (!address || items.length == 0) {
            return res.json({ success: false, message: "Invalid data" })
        }

        let productData = [];

        // Calculate Amount Using Items
        let amount = await items.reduce(async (acc, item) => {
            const product = await Product.findById(item.product);
            productData.push({
                name: product.name,
                price: product.offerPrice,
                quantity: item.quantity,
            });
            return (await acc) + product.offerPrice * item.quantity;
        }, 0)

        // Add Tax Charge (2%)
        amount += Math.floor(amount * 0.02);

        const order = await Order.create({
            userId,
            items,
            amount,
            address,
            paymentType: "Online",
        });

        // Stripe Gateway Initialize    
        const stripeInstance = new stripe(process.env.STRIPE_SECRET_KEY);

        // create line items for stripe

        const line_items = productData.map((item) => {
            return {
                price_data: {
                    currency: "rs",
                    product_data: {
                        name: item.name,
                    },
                    unit_amount: Math.floor(item.price + item.price * 0.02) * 100
                },
                quantity: item.quantity,
            }
        })

        // create session
        const session = await stripeInstance.checkout.sessions.create({
            line_items,
            mode: "payment",
            success_url: `${origin}/loader?next=my-orders`,
            cancel_url: `${origin}/cart`,
            metadata: {
                orderId: order._id.toString(),
                userId: userId.toString(), // Added .toString() for safety
            }
        })

        return res.json({ success: true, url: session.url });
    } catch (error) {
        return res.json({ success: false, message: error.message });
    }
}
// Stripe Webhooks to Verify Payments Action : /stripe
export const stripeWebhooks = async (request, response) => {
    const stripeInstance = new stripe(process.env.STRIPE_SECRET_KEY);
    const sig = request.headers["stripe-signature"];
    let event;

    try {
        event = stripeInstance.webhooks.constructEvent(
            request.body,
            sig,
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (error) {
        console.log(`❌ Webhook Error: ${error.message}`);
        return response.status(400).send(`Webhook Error: ${error.message}`);
    }

    if (event.type === "checkout.session.completed") {
        const session = event.data.object;

        // Extract metadata we sent during placeOrderStripe
        const { orderId, userId } = session.metadata;

        if (orderId && userId) {
            // 1. Mark Order as Paid
            await Order.findByIdAndUpdate(orderId, { isPaid: true });

            // 2. Clear User's Cart
            await User.findByIdAndUpdate(userId, { cartItems: {} });

            console.log(`✅ Success! Order ${orderId} paid and Cart cleared for User ${userId}`);
        }
    }

    response.json({ received: true });
};


// Get Orders by User ID : /api/order/user
export const getUserOrders = async (req, res) => {
    try {
        const { userId } = req.body;
        const orders = await Order.find({ userId }) // Simply find all orders for this user
            .populate("items.product address")
            .sort({ createdAt: -1 });
        res.json({ success: true, orders });
    } catch (error) {
        res.json({ success: false, message: error.message });
    }
}


// Get All Orders ( for seller / admin) : /api/order/seller
export const getAllOrders = async (req, res) => {
    try {
        const orders = await Order.find({}) // Find every order in the database
            .populate("items.product address")
            .sort({ createdAt: -1 });
        res.json({ success: true, orders });
    } catch (error) {
        res.json({ success: false, message: error.message });
    }
}