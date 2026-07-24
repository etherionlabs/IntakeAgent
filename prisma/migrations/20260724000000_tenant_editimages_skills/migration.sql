-- Control por-tenant de previsualización de imágenes y skills.
ALTER TABLE "TenantSettings" ADD COLUMN "editImages" BOOLEAN NOT NULL DEFAULT false;
-- skills: null = hereda las del perfil del giro; arreglo JSON = selección explícita del panel.
ALTER TABLE "TenantSettings" ADD COLUMN "skills" JSONB;
