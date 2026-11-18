ALTER TABLE "FacebookPageSettings"
ALTER COLUMN "greetingMessage"
SET DEFAULT 'Bonjour ! Merci de nous avoir contactés. Nous serons ravis de vous aider. Quel produit souhaitez-vous commander ? Indiquez-nous son nom ou envoyez-nous une photo, et nous vous guiderons pour la suite.';

UPDATE "FacebookPageSettings"
SET "greetingMessage" = 'Bonjour ! Merci de nous avoir contactés. Nous serons ravis de vous aider. Quel produit souhaitez-vous commander ? Indiquez-nous son nom ou envoyez-nous une photo, et nous vous guiderons pour la suite.'
WHERE "greetingMessage" = 'Bonjour, merci de nous avoir contactés. Nous revenons vers vous rapidement.';
