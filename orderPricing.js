const districtsByDivision = {
  Dhaka: ["Dhaka", "Faridpur", "Gazipur", "Gopalganj", "Kishoreganj", "Madaripur", "Manikganj", "Munshiganj", "Narayanganj", "Narsingdi", "Rajbari", "Shariatpur", "Tangail"],
  Chattogram: ["Bandarban", "Brahmanbaria", "Chandpur", "Chattogram", "Cumilla", "Cox's Bazar", "Feni", "Khagrachhari", "Lakshmipur", "Noakhali", "Rangamati"],
  Rajshahi: ["Bogura", "Joypurhat", "Naogaon", "Natore", "Chapainawabganj", "Pabna", "Rajshahi", "Sirajganj"],
  Khulna: ["Bagerhat", "Chuadanga", "Jashore", "Jhenaidah", "Khulna", "Kushtia", "Magura", "Meherpur", "Narail", "Satkhira"],
  Barishal: ["Barguna", "Barishal", "Bhola", "Jhalokati", "Patuakhali", "Pirojpur"],
  Sylhet: ["Habiganj", "Moulvibazar", "Sunamganj", "Sylhet"],
  Rangpur: ["Dinajpur", "Gaibandha", "Kurigram", "Lalmonirhat", "Nilphamari", "Panchagarh", "Rangpur", "Thakurgaon"],
  Mymensingh: ["Jamalpur", "Mymensingh", "Netrokona", "Sherpur"],
};

const districtToDivision = new Map(
  Object.entries(districtsByDivision).flatMap(([division, districts]) =>
    districts.map((district) => [district.toLocaleLowerCase("en"), division.toLocaleLowerCase("en")]),
  ),
);

export function getDeliveryCharge(district, division) {
  const normalizedDistrict = String(district || "").trim().toLocaleLowerCase("en");
  const actualDivision = districtToDivision.get(normalizedDistrict);
  if (!actualDivision) return null;

  const normalizedDivision = String(division || "").trim().toLocaleLowerCase("en");
  if (normalizedDivision && normalizedDivision !== actualDivision) return null;
  return normalizedDistrict === "dhaka" ? 70 : 130;
}

export function calculateOrderTotals(unitPrice, quantity, district, division) {
  const deliveryCharge = getDeliveryCharge(district, division);
  if (deliveryCharge == null) return null;
  const subtotalAmount = Math.round(Number(unitPrice) * Number(quantity) * 100) / 100;
  return {
    subtotalAmount,
    deliveryCharge,
    totalAmount: Math.round((subtotalAmount + deliveryCharge) * 100) / 100,
  };
}
