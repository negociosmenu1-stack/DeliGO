import { PrismaClient } from "@prisma/client"
import { hashPassword } from "../src/lib/auth"

const db = new PrismaClient()

async function main() {
  console.log("🌱 Seedando base de datos DeliGO...")

  // Limpiar datos existentes
  await db.sesion.deleteMany()
  await db.deudaHistorial.deleteMany()
  await db.chatMensaje.deleteMany()
  await db.resena.deleteMany()
  await db.pedidoItem.deleteMany()
  await db.pedido.deleteMany()
  await db.seccionProducto.deleteMany()
  await db.seccionCatalogo.deleteMany()
  await db.productoAgregado.deleteMany()
  await db.productoIngrediente.deleteMany()
  await db.agregado.deleteMany()
  await db.ingrediente.deleteMany()
  await db.producto.deleteMany()
  await db.favorito.deleteMany()
  await db.direccion.deleteMany()
  await db.repartidorNegocio.deleteMany()
  await db.promocion.deleteMany()
  await db.cliente.deleteMany()
  await db.repartidor.deleteMany()
  await db.negocio.deleteMany()
  await db.superAdmin.deleteMany()

  // ============================================
  // SUPERADMIN
  // ============================================
  const adminPassword = await hashPassword("admin123")
  await db.superAdmin.create({
    data: { password: adminPassword },
  })
  console.log("✅ SuperAdmin creado")

  // ============================================
  // CLIENTES
  // ============================================
  const clientePassword = await hashPassword("123456")
  const cliente1 = await db.cliente.create({
    data: {
      nombre: "María González",
      email: "test@deligo.com",
      password: clientePassword,
      telefono: "1134567890",
    },
  })
  const cliente2 = await db.cliente.create({
    data: {
      nombre: "Juan Pérez",
      email: "juan@deligo.com",
      password: clientePassword,
      telefono: "1198765432",
    },
  })
  console.log("✅ Clientes creados")

  // ============================================
  // REPARTIDORES
  // ============================================
  const repartidorPassword = await hashPassword("123456")
  const repartidor1 = await db.repartidor.create({
    data: {
      nombre: "Carlos Ruiz",
      email: "repartidor@deligo.com",
      password: repartidorPassword,
      telefono: "1165432109",
      activo: true,
    },
  })
  console.log("✅ Repartidor creado")

  // ============================================
  // NEGOCIOS
  // ============================================
  const negocioPassword = await hashPassword("123456")

  const horariosDefault = JSON.stringify({
    "1": { abierto: true, apertura: "09:00", cierre: "23:00" },
    "2": { abierto: true, apertura: "09:00", cierre: "23:00" },
    "3": { abierto: true, apertura: "09:00", cierre: "23:00" },
    "4": { abierto: true, apertura: "09:00", cierre: "23:00" },
    "5": { abierto: true, apertura: "09:00", cierre: "23:59" },
    "6": { abierto: true, apertura: "10:00", cierre: "23:59" },
    "7": { abierto: true, apertura: "11:00", cierre: "22:00" },
  })

  const negociosData = [
    {
      slug: "parrilla-don-jorge",
      nombre: "Parrilla Don Jorge",
      usuario: "donjorge",
      rubro: "restaurante",
      colorPrincipal: "#D32F2F",
      mensajeBienvenida: "¡Bienvenido a la mejor parrilla de Buenos Aires! 🥩",
      categorias: JSON.stringify(["Parrilla", "Entradas", "Postres", "Bebidas"]),
      agregadosCategorias: JSON.stringify(["Acompañamientos", "Salsas"]),
      ingredientesCategorias: JSON.stringify(["Vegetales", "Condimentos"]),
      ofreceDelivery: true,
      precioDelivery: 350,
      tiempoEntrega: 45,
      puntuacionPromedio: 4.7,
      totalResenas: 89,
      horarios: horariosDefault,
      whatsapp: "5491112345678",
      aceptaTransferencia: true,
      aliasBancario: "PARRILLA.JORGE.MP",
      zonasDelivery: JSON.stringify([
        { nombre: "Zona Centro", precio: 350, puntos: [[-34.60, -58.38], [-34.61, -58.37], [-34.62, -58.39], [-34.60, -58.40]] },
      ]),
    },
    {
      slug: "sushi-zen",
      nombre: "Sushi Zen",
      usuario: "sushizen",
      rubro: "restaurante",
      colorPrincipal: "#1565C0",
      mensajeBienvenida: "🍣 Sushi fresco, directo a tu puerta",
      categorias: JSON.stringify(["Sushi", "Entradas", "Postres", "Bebidas"]),
      agregadosCategorias: JSON.stringify(["Extras", "Salsas"]),
      ingredientesCategorias: JSON.stringify(["Pescados", "Vegetales"]),
      ofreceDelivery: true,
      precioDelivery: 400,
      tiempoEntrega: 35,
      puntuacionPromedio: 4.5,
      totalResenas: 64,
      horarios: horariosDefault,
      zonasDelivery: JSON.stringify([
        { nombre: "Zona Norte", precio: 400, puntos: [[-34.58, -58.39], [-34.57, -58.38], [-34.56, -58.40], [-34.58, -58.41]] },
      ]),
    },
    {
      slug: "pizza-tradizionale",
      nombre: "Pizza Tradizionale",
      usuario: "tradizionale",
      rubro: "restaurante",
      colorPrincipal: "#E65100",
      mensajeBienvenida: "🍕 La pizza como en Nápoles, acá en Buenos Aires",
      categorias: JSON.stringify(["Pizzas", "Empanadas", "Postres", "Bebidas"]),
      agregadosCategorias: JSON.stringify(["Extra queso", "Ingredientes extra"]),
      ingredientesCategorias: JSON.stringify(["Quesos", "Vegetales", "Carnes"]),
      ofreceDelivery: true,
      precioDelivery: 250,
      tiempoEntrega: 30,
      puntuacionPromedio: 4.3,
      totalResenas: 112,
      horarios: horariosDefault,
      aceptaTransferencia: true,
      aliasBancario: "PIZZA.TRADI.MP",
    },
    {
      slug: "helados-friorento",
      nombre: "Helados Friorento",
      usuario: "friorento",
      rubro: "restaurante",
      colorPrincipal: "#7B1FA2",
      mensajeBienvenida: "🍦 ¡Los helados más cremosos de la ciudad!",
      categorias: JSON.stringify(["Helados", "Postres", "Bebidas frías"]),
      ingredientesCategorias: JSON.stringify(["Frutas", "Toppings"]),
      ofreceDelivery: true,
      precioDelivery: 200,
      tiempoEntrega: 20,
      puntuacionPromedio: 4.8,
      totalResenas: 45,
      horarios: JSON.stringify({
        "1": { abierto: true, apertura: "12:00", cierre: "23:00" },
        "2": { abierto: true, apertura: "12:00", cierre: "23:00" },
        "3": { abierto: true, apertura: "12:00", cierre: "23:00" },
        "4": { abierto: true, apertura: "12:00", cierre: "23:00" },
        "5": { abierto: true, apertura: "12:00", cierre: "23:59" },
        "6": { abierto: true, apertura: "10:00", cierre: "23:59" },
        "7": { abierto: true, apertura: "10:00", cierre: "23:00" },
      }),
    },
    {
      slug: "burger-lab",
      nombre: "Burger Lab",
      usuario: "burgerlab",
      rubro: "restaurante",
      colorPrincipal: "#FF6F00",
      mensajeBienvenida: "🍔 Smashed burgers, máximo sabor",
      categorias: JSON.stringify(["Hamburguesas", "Papas", "Postres", "Bebidas"]),
      agregadosCategorias: JSON.stringify(["Extra toppings", "Salsas"]),
      ingredientesCategorias: JSON.stringify(["Vegetales", "Quesos"]),
      ofreceDelivery: true,
      precioDelivery: 300,
      tiempoEntrega: 25,
      puntuacionPromedio: 4.6,
      totalResenas: 150,
      horarios: horariosDefault,
    },
    {
      slug: "empanadas-la-nortena",
      nombre: "Empanadas La Norteña",
      usuario: "lanortena",
      rubro: "restaurante",
      colorPrincipal: "#2E7D32",
      mensajeBienvenida: "🥟 Empanadas caseras como las de la abuela",
      categorias: JSON.stringify(["Empanadas", "Pizzas", "Tartas", "Bebidas"]),
      ofreceDelivery: true,
      precioDelivery: 200,
      tiempoEntrega: 35,
      puntuacionPromedio: 4.4,
      totalResenas: 73,
      horarios: horariosDefault,
      aceptaTransferencia: true,
      aliasBancario: "EMPANADA.NORTE.MP",
    },
    {
      slug: "moda-urbana",
      nombre: "Moda Urbana",
      usuario: "modaurbana",
      rubro: "ropa",
      colorPrincipal: "#5D4037",
      mensajeBienvenida: "👕 Estilo urbano, envío a tu puerta",
      categorias: JSON.stringify(["Remeras", "Pantalones", "Camperas", "Accesorios"]),
      ofreceDelivery: true,
      precioDelivery: 500,
      tiempoEntrega: 60,
      puntuacionPromedio: 3.9,
      totalResenas: 28,
      horarios: JSON.stringify({
        "1": { abierto: true, apertura: "10:00", cierre: "20:00" },
        "2": { abierto: true, apertura: "10:00", cierre: "20:00" },
        "3": { abierto: true, apertura: "10:00", cierre: "20:00" },
        "4": { abierto: true, apertura: "10:00", cierre: "20:00" },
        "5": { abierto: true, apertura: "10:00", cierre: "21:00" },
        "6": { abierto: true, apertura: "09:00", cierre: "21:00" },
        "7": { abierto: false },
      }),
    },
    {
      slug: "deportes-max",
      nombre: "Deportes Max",
      usuario: "deportesmax",
      rubro: "otro",
      colorPrincipal: "#0277BD",
      mensajeBienvenida: "🏋️ Todo para tu entrenamiento",
      categorias: JSON.stringify(["Calzado", "Indumentaria", "Accesorios", "Suplementos"]),
      ofreceDelivery: true,
      precioDelivery: 450,
      tiempoEntrega: 48,
      puntuacionPromedio: 4.1,
      totalResenas: 35,
      horarios: JSON.stringify({
        "1": { abierto: true, apertura: "09:00", cierre: "19:00" },
        "2": { abierto: true, apertura: "09:00", cierre: "19:00" },
        "3": { abierto: true, apertura: "09:00", cierre: "19:00" },
        "4": { abierto: true, apertura: "09:00", cierre: "19:00" },
        "5": { abierto: true, apertura: "09:00", cierre: "20:00" },
        "6": { abierto: true, apertura: "09:00", cierre: "20:00" },
        "7": { abierto: false },
      }),
    },
  ]

  const negocios: Record<string, string> = {}

  for (const data of negociosData) {
    const negocio = await db.negocio.create({
      data: {
        ...data,
        password: negocioPassword,
        aprobado: true,
        suspendido: false,
        repartidorCodigo: `NF-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
        planTipo: "prueba",
        planVencimiento: "2025-12-31",
      },
    })
    negocios[data.slug] = negocio.id
    console.log(`✅ Negocio: ${data.nombre}`)
  }

  // ============================================
  // PRODUCTOS (save IDs for linking)
  // ============================================
  const productoIds: Record<string, string[]> = {} // slug -> array of producto IDs

  const productosData: Record<string, Array<{ nombre: string; precio: number; categoria: string; descripcion?: string; descuentoActivo?: boolean; tipoDescuento?: string; valorDescuento?: number; secciones?: string }>> = {
    "parrilla-don-jorge": [
      { nombre: "Bife de Chorizo", precio: 12000, categoria: "Parrilla", descripcion: "Corte premium de 400g a la parrilla con sal gruesa", secciones: JSON.stringify([{ nombre: "Punto de cocción", opciones: ["A punto", "Jugoso", "Bien cocido"], obligatorio: true }] ) },
      { nombre: "Asado de Tira", precio: 8500, categoria: "Parrilla", descripcion: "500g de asado de tira cocido a fuego lento" },
      { nombre: "Entraña", precio: 9000, categoria: "Parrilla", descripcion: "Entraña fina a la parrilla, 300g" },
      { nombre: "Provoleta", precio: 4500, categoria: "Entradas", descripcion: "Queso provoleta a la parrilla con orégano" },
      { nombre: "Empanadas x6", precio: 3800, categoria: "Entradas", descripcion: "6 empanadas de carne cortadas a cuchillo" },
      { nombre: "Flan con Dulce", precio: 2500, categoria: "Postres", descripcion: "Flan casero con dulce de leche y crema" },
      { nombre: "Vino Malbec", precio: 3500, categoria: "Bebidas", descripcion: "Botella de Malbec de la casa" },
      { nombre: "Agua 500ml", precio: 800, categoria: "Bebidas" },
    ],
    "sushi-zen": [
      { nombre: "Combo 24 piezas", precio: 9800, categoria: "Sushi", descripcion: "12 salmon, 6 california, 6 nigiri", descuentoActivo: true, tipoDescuento: "porcentaje", valorDescuento: 15, secciones: JSON.stringify([{ nombre: "Salsa extra", opciones: ["Salsa de soja", "Eel sauce", "Spicy mayo"], obligatorio: false }] ) },
      { nombre: "Philadelphia Roll x8", precio: 4200, categoria: "Sushi", descripcion: "Salmón, queso crema y palta" },
      { nombre: "Nigiri Salmón x4", precio: 3800, categoria: "Sushi", descripcion: "4 piezas de nigiri de salmón fresco" },
      { nombre: "Gyosa x6", precio: 3200, categoria: "Entradas", descripcion: "Empanaditas japonesas rellenas de cerdo" },
      { nombre: "Sopa Miso", precio: 1800, categoria: "Entradas", descripcion: "Sopa de miso con tofu y cebollín" },
      { nombre: "Helado verde", precio: 2200, categoria: "Postres", descripcion: "Helado de té verde con salsa de chocolate" },
      { nombre: "Sake 200ml", precio: 4500, categoria: "Bebidas" },
    ],
    "pizza-tradizionale": [
      { nombre: "Muzzarella Grande", precio: 5500, categoria: "Pizzas", descripcion: "Pizza grande con muzzarella fundida" },
      { nombre: "Napolitana Grande", precio: 6200, categoria: "Pizzas", descripcion: "Salsa, muzzarella, tomate y ajo" },
      { nombre: "Fugazzeta Grande", precio: 6800, categoria: "Pizzas", descripcion: "Pizza rellena de queso con cebolla", descuentoActivo: true, tipoDescuento: "porcentaje", valorDescuento: 20 },
      { nombre: "Empanadas x12", precio: 5800, categoria: "Empanadas", descripcion: "12 empanadas surtidas de carne y pollo" },
      { nombre: "Faina x4", precio: 1500, categoria: "Empanadas", descripcion: "4 porciones de faina crocante" },
      { nombre: "Cerveza Artesanal", precio: 2200, categoria: "Bebidas" },
    ],
    "helados-friorento": [
      { nombre: "1/4 Kg Helado", precio: 3200, categoria: "Helados", descripcion: "Elegí hasta 3 gustos" },
      { nombre: "1/2 Kg Helado", precio: 5200, categoria: "Helados", descripcion: "Elegí hasta 4 gustos" },
      { nombre: "1 Kg Helado", precio: 8500, categoria: "Helados", descripcion: "Elegí hasta 6 gustos", descuentoActivo: true, tipoDescuento: "monto", valorDescuento: 500 },
      { nombre: "Sundae", precio: 2800, categoria: "Postres", descripcion: "Helado con salsa, crema y cereza" },
      { nombre: "Milkshake", precio: 2500, categoria: "Bebidas frías", descripcion: "Batido de helado con leche" },
    ],
    "burger-lab": [
      { nombre: "Smash Burger Simple", precio: 4500, categoria: "Hamburguesas", descripcion: "Doble smash patty, cheddar, salsa especial", secciones: JSON.stringify([{ nombre: "Punto de la carne", opciones: ["Jugosa", "A punto", "Bien cocida"], obligatorio: true }] ) },
      { nombre: "Smash Burger Doble", precio: 5800, categoria: "Hamburguesas", descripcion: "4 smash patties, cheddar, bacon, salsa", descuentoActivo: true, tipoDescuento: "porcentaje", valorDescuento: 10 },
      { nombre: "Veggie Burger", precio: 4200, categoria: "Hamburguesas", descripcion: "Medallón de lentejas, palta, rúcula" },
      { nombre: "Papas Cheddar x2", precio: 3000, categoria: "Papas", descripcion: "Papas fritas con cheddar y bacon" },
      { nombre: "Papas Clásicas", precio: 1800, categoria: "Papas", descripcion: "Papas fritas crocantes" },
      { nombre: "Brownie con Helado", precio: 2800, categoria: "Postres", descripcion: "Brownie tibio con helado de vainilla" },
      { nombre: "Gaseosa 500ml", precio: 1000, categoria: "Bebidas" },
    ],
    "empanadas-la-nortena": [
      { nombre: "Docena Empanadas Carne", precio: 5800, categoria: "Empanadas", descripcion: "12 empanadas de carne cortada a cuchillo" },
      { nombre: "Docena Empanadas Sur", precio: 5800, categoria: "Empanadas", descripcion: "12 empanadas surtidas: carne, pollo, jamón y queso" },
      { nombre: "Media Docena", precio: 3200, categoria: "Empanadas", descripcion: "6 empanadas del sabor que elijas", descuentoActivo: true, tipoDescuento: "porcentaje", valorDescuento: 15 },
      { nombre: "Pizza Muzzarella", precio: 5200, categoria: "Pizzas", descripcion: "Pizza de molde con muzzarella" },
      { nombre: "Tarta de Jamón", precio: 4500, categoria: "Tartas", descripcion: "Tarta de jamón y queso" },
    ],
    "moda-urbana": [
      { nombre: "Remera Oversize", precio: 8500, categoria: "Remeras", descripcion: "100% algodón, talles S-XXL", talles: JSON.stringify(["S", "M", "L", "XL", "XXL"]), colores: JSON.stringify(["Negro", "Blanco", "Gris"]), genero: "Unisex", material: "Algodón" },
      { nombre: "Jogger Cargo", precio: 15000, categoria: "Pantalones", descripcion: "Pantalón cargo con bolsillos", talles: JSON.stringify(["S", "M", "L", "XL"]), colores: JSON.stringify(["Negro", "Verde militar"]), genero: "Unisex", material: "Gabardina" },
      { nombre: "Campera Rompeviento", precio: 22000, categoria: "Camperas", descripcion: "Campera impermeable con capucha", talles: JSON.stringify(["M", "L", "XL"]), colores: JSON.stringify(["Negro", "Azul"]), genero: "Unisex", material: "Nylon", descuentoActivo: true, tipoDescuento: "porcentaje", valorDescuento: 25 },
      { nombre: "Gorra Trucker", precio: 5500, categoria: "Accesorios", descripcion: "Gorra con mesh trasera", colores: JSON.stringify(["Negro", "Blanco", "Rojo"]), genero: "Unisex" },
    ],
    "deportes-max": [
      { nombre: "Zapatillas Running", precio: 45000, categoria: "Calzado", descripcion: "Zapatillas para running profesional", talles: JSON.stringify(["38", "39", "40", "41", "42", "43", "44"]), colores: JSON.stringify(["Negro", "Blanco"]), genero: "Unisex" },
      { nombre: "Short Deportivo", precio: 6800, categoria: "Indumentaria", descripcion: "Short de entrenamiento DryFit", talles: JSON.stringify(["S", "M", "L", "XL"]), colores: JSON.stringify(["Negro", "Azul", "Rojo"]), genero: "Hombre", material: "DryFit" },
      { nombre: "Mancuernas 5kg x2", precio: 12000, categoria: "Accesorios", descripcion: "Par de mancuernas de 5kg cromadas" },
      { nombre: "Proteína Whey 1kg", precio: 25000, categoria: "Suplementos", descripcion: "Proteína de suero de leche, sabor vainilla", descuentoActivo: true, tipoDescuento: "monto", valorDescuento: 2000 },
    ],
  }

  for (const [slug, prods] of Object.entries(productosData)) {
    const negocioId = negocios[slug]
    if (!negocioId) continue

    const ids: string[] = []
    for (const p of prods) {
      const { descuentoActivo, tipoDescuento, valorDescuento, talles, colores, genero, material, secciones, ...base } = p as any
      const producto = await db.producto.create({
        data: {
          ...base,
          negocioId,
          descuentoActivo: descuentoActivo ?? false,
          tipoDescuento: tipoDescuento ?? "porcentaje",
          valorDescuento: valorDescuento ?? 0,
          talles: talles ?? "[]",
          colores: colores ?? "[]",
          genero: genero ?? "",
          material: material ?? "",
          secciones: secciones ?? "[]",
          stock: true,
        },
      })
      ids.push(producto.id)
    }
    productoIds[slug] = ids
    console.log(`✅ Productos: ${slug} (${prods.length})`)
  }

  // ============================================
  // AGREGADOS (para restaurantes) + Link to products
  // ============================================
  const agregadosData: Record<string, Array<{ nombre: string; precio: number; categoria: string; productosIndices?: number[] }>> = {
    "parrilla-don-jorge": [
      { nombre: "Papas fritas", precio: 1500, categoria: "Acompañamientos", productosIndices: [0, 1, 2] },
      { nombre: "Ensalada mixta", precio: 1200, categoria: "Acompañamientos", productosIndices: [0, 1, 2] },
      { nombre: "Chimichurri extra", precio: 300, categoria: "Salsas", productosIndices: [0, 1, 2] },
      { nombre: "Salsa criolla", precio: 300, categoria: "Salsas", productosIndices: [0, 1, 2] },
    ],
    "sushi-zen": [
      { nombre: "Pasta de wasabi", precio: 200, categoria: "Extras", productosIndices: [0, 1, 2] },
      { nombre: "Jengibre extra", precio: 200, categoria: "Extras", productosIndices: [0, 1, 2] },
      { nombre: "Salsa de soja", precio: 150, categoria: "Salsas", productosIndices: [0, 1, 2] },
    ],
    "burger-lab": [
      { nombre: "Extra cheddar", precio: 500, categoria: "Extra toppings", productosIndices: [0, 1, 2] },
      { nombre: "Bacon extra", precio: 700, categoria: "Extra toppings", productosIndices: [0, 1, 2] },
      { nombre: "Huevo frito", precio: 400, categoria: "Extra toppings", productosIndices: [0, 1, 2] },
      { nombre: "Salsa BBQ", precio: 200, categoria: "Salsas", productosIndices: [0, 1, 2] },
    ],
    "pizza-tradizionale": [
      { nombre: "Extra muzzarella", precio: 800, categoria: "Extra queso", productosIndices: [0, 1, 2] },
      { nombre: "Aceitunas", precio: 300, categoria: "Ingredientes extra", productosIndices: [0, 1] },
      { nombre: "Jamón", precio: 500, categoria: "Ingredientes extra", productosIndices: [0, 1, 2] },
    ],
  }

  for (const [slug, agrs] of Object.entries(agregadosData)) {
    const negocioId = negocios[slug]
    const pIds = productoIds[slug]
    if (!negocioId || !pIds) continue

    for (const a of agrs) {
      const { productosIndices, ...agregadoData } = a
      const agregado = await db.agregado.create({
        data: { ...agregadoData, negocioId },
      })

      // Link to products
      if (productosIndices && pIds.length > 0) {
        for (const idx of productosIndices) {
          if (pIds[idx]) {
            await db.productoAgregado.create({
              data: {
                productoId: pIds[idx],
                agregadoId: agregado.id,
              },
            })
          }
        }
      }
    }
    console.log(`✅ Agregados: ${slug} (${agrs.length})`)
  }

  // ============================================
  // INGREDIENTES (para restaurantes)
  // ============================================
  const ingredientesData: Record<string, Array<{ nombre: string; categoria: string; productosIndices?: number[] }>> = {
    "parrilla-don-jorge": [
      { nombre: "Ajos asados", categoria: "Condimentos", productosIndices: [0, 1] },
      { nombre: "Provenzal", categoria: "Condimentos", productosIndices: [0, 1, 2] },
      { nombre: "Rúcula", categoria: "Vegetales", productosIndices: [0, 1] },
      { nombre: "Tomate cherry", categoria: "Vegetales", productosIndices: [0, 1] },
    ],
    "burger-lab": [
      { nombre: "Lechuga", categoria: "Vegetales", productosIndices: [0, 1, 2] },
      { nombre: "Tomate", categoria: "Vegetales", productosIndices: [0, 1, 2] },
      { nombre: "Cebolla caramelizada", categoria: "Vegetales", productosIndices: [0, 1] },
      { nombre: "Pepinillos", categoria: "Vegetales", productosIndices: [0, 1, 2] },
    ],
    "pizza-tradizionale": [
      { nombre: "Muzzarella", categoria: "Quesos", productosIndices: [0, 1, 2] },
      { nombre: "Provolone", categoria: "Quesos", productosIndices: [0, 1] },
      { nombre: "Tomate en rodajas", categoria: "Vegetales", productosIndices: [1] },
      { nombre: "Morrones", categoria: "Vegetales", productosIndices: [0, 1] },
    ],
  }

  for (const [slug, ings] of Object.entries(ingredientesData)) {
    const negocioId = negocios[slug]
    const pIds = productoIds[slug]
    if (!negocioId || !pIds) continue

    for (const i of ings) {
      const { productosIndices, ...ingredienteData } = i
      const ingrediente = await db.ingrediente.create({
        data: { ...ingredienteData, negocioId },
      })

      // Link to products
      if (productosIndices && pIds.length > 0) {
        for (const idx of productosIndices) {
          if (pIds[idx]) {
            await db.productoIngrediente.create({
              data: {
                productoId: pIds[idx],
                ingredienteId: ingrediente.id,
              },
            })
          }
        }
      }
    }
    console.log(`✅ Ingredientes: ${slug} (${ings.length})`)
  }

  // ============================================
  // SECCIONES CATÁLOGO
  // ============================================
  // Create a "Recomendados" section for parrilla-don-jorge
  if (productoIds["parrilla-don-jorge"]) {
    const seccion = await db.seccionCatalogo.create({
      data: {
        nombre: "🔥 Recomendados",
        orientacion: "horizontal",
        orden: 0,
        color: "#D32F2F10",
        negocioId: negocios["parrilla-don-jorge"]!,
      },
    })
    // Add first 3 products to the section
    for (let i = 0; i < Math.min(3, productoIds["parrilla-don-jorge"].length); i++) {
      await db.seccionProducto.create({
        data: {
          seccionId: seccion.id,
          productoId: productoIds["parrilla-don-jorge"][i],
          orden: i,
        },
      })
    }
    console.log("✅ Sección: Recomendados (parrilla-don-jorge)")
  }

  // Create a "Más vendidas" section for burger-lab
  if (productoIds["burger-lab"]) {
    const seccion = await db.seccionCatalogo.create({
      data: {
        nombre: "⭐ Más vendidas",
        orientacion: "horizontal",
        orden: 0,
        color: "#FF6F0010",
        negocioId: negocios["burger-lab"]!,
      },
    })
    for (let i = 0; i < Math.min(3, productoIds["burger-lab"].length); i++) {
      await db.seccionProducto.create({
        data: {
          seccionId: seccion.id,
          productoId: productoIds["burger-lab"][i],
          orden: i,
        },
      })
    }
    console.log("✅ Sección: Más vendidas (burger-lab)")
  }

  // ============================================
  // RESEÑAS (Reviews) — requires Pedido, skip for now
  // ============================================
  console.log("⏭️ Reseñas: se crearán con el sistema de pedidos")

  console.log("\n🎉 Seed completado exitosamente!")
  console.log("📧 Cliente test: test@deligo.com / 123456")
  console.log("🏪 Negocio test: donjorge / 123456")
  console.log("🛵 Repartidor test: repartidor@deligo.com / 123456")
  console.log("👑 Admin: admin123")
}

main()
  .catch((e) => {
    console.error("❌ Error:", e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
