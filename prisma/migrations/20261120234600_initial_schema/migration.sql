-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Status" AS ENUM ('reserved', 'payed', 'canceled');

-- CreateEnum
CREATE TYPE "UserType" AS ENUM ('admin', 'user');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "profil" TEXT NOT NULL DEFAULT 'user',
    "type" "UserType" NOT NULL DEFAULT 'user',
    "password" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordChangeChallenge" (
    "userId" TEXT NOT NULL,
    "otpHash" TEXT NOT NULL,
    "currentPasswordHash" TEXT NOT NULL,
    "newPasswordHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordChangeChallenge_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "session_id" TEXT,
    "code_article" TEXT,
    "nom" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "prix" DECIMAL(65,30) NOT NULL,
    "image_url" TEXT,
    "initial" INTEGER NOT NULL,
    "available" INTEGER NOT NULL,
    "facebook_post_id" TEXT,
    "facebook_published_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductColor" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "initial" INTEGER NOT NULL,
    "available" INTEGER NOT NULL,

    CONSTRAINT "ProductColor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "session_id" TEXT,
    "facebook_user_id" TEXT,
    "customer_name" TEXT,
    "delivery_address" TEXT,
    "customer_phone" TEXT,
    "produit_id" TEXT,
    "quantity" INTEGER,
    "status" "Status" NOT NULL DEFAULT 'reserved',
    "facebook_channel" TEXT,
    "facebook_event_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productColorId" TEXT,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacebookWebhookEvent" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "senderId" TEXT,
    "status" TEXT NOT NULL,
    "orderId" TEXT,
    "replyText" TEXT,
    "replySent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FacebookWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacebookPendingOrder" (
    "id" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER,
    "customerName" TEXT,
    "customerPhone" TEXT,
    "deliveryAddress" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacebookPendingOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacebookPageSettings" (
    "id" TEXT NOT NULL,
    "greetingMessage" TEXT NOT NULL DEFAULT 'Bonjour ! Merci de nous avoir contactés. Nous serons ravis de vous aider. Quel produit souhaitez-vous commander ? Indiquez-nous son nom ou envoyez-nous une photo, et nous vous guiderons pour la suite.',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FacebookPageSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "facebook_live_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "facebook_user_id" TEXT NOT NULL,
    "nom_facebook" TEXT NOT NULL,
    "telephone" TEXT,
    "address" TEXT,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("facebook_user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ProductColor_productId_name_key" ON "ProductColor"("productId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Order_facebook_event_id_key" ON "Order"("facebook_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "OrderItem_orderId_productId_key" ON "OrderItem"("orderId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "FacebookWebhookEvent_channel_eventId_key" ON "FacebookWebhookEvent"("channel", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "FacebookPendingOrder_senderId_key" ON "FacebookPendingOrder"("senderId");

-- AddForeignKey
ALTER TABLE "PasswordChangeChallenge" ADD CONSTRAINT "PasswordChangeChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductColor" ADD CONSTRAINT "ProductColor_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productColorId_fkey" FOREIGN KEY ("productColorId") REFERENCES "ProductColor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacebookPendingOrder" ADD CONSTRAINT "FacebookPendingOrder_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

